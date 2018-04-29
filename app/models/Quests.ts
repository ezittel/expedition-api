import * as Sequelize from 'sequelize'
import {Feedback, FeedbackInstance} from './Feedback'
import {RenderedQuest} from './RenderedQuests'
import {User, UserAttributes} from './Users'
import {toSequelize, prepare} from './Schema'
import {Quest as QuestAttributes} from 'expedition-qdl/lib/schema/Quests'
import {PUBLIC_PARTITION} from 'expedition-qdl/lib/schema/Constants'

import * as Mail from '../Mail'
import * as Bluebird from 'bluebird'

export const MAX_SEARCH_LIMIT = 100;

const SequelizeQuest = toSequelize(new QuestAttributes({id: '', partition: PUBLIC_PARTITION}));

export interface QuestSearchParams {
  id?: string|null;
  owner?: string|null;
  players?: number|null;
  text?: string|null;
  age?: number|null;
  mintimeminutes?: number|null;
  maxtimeminutes?: number|null;
  contentrating?: string|null;
  genre?: string|null;
  order?: string|null;
  limit?: number|null;
  partition?: string|null;
  expansions?: string[]|null;
  language?: string|null;
}

export interface QuestInstance extends Sequelize.Instance<Partial<QuestAttributes>> {}

export type QuestModel = Sequelize.Model<QuestInstance, Partial<QuestAttributes>>;

export class Quest {
  protected s: Sequelize.Sequelize;
  protected mc: any;
  protected feedback: Feedback;
  protected rendered: RenderedQuest;
  protected user: User;
  public model: QuestModel;

  constructor(s: Sequelize.Sequelize) {
    this.s = s;
    this.model = this.s.define<QuestInstance, Partial<QuestAttributes>>('quests', SequelizeQuest, {
      timestamps: false, // TODO: eventually switch to sequelize timestamps
      // https://github.com/ExpeditionRPG/expedition-api/issues/39
      underscored: true,
    });
  }

  create(attrs: Partial<QuestAttributes>) {
    return this.model.create(prepare(new QuestAttributes(attrs)));
  }

  associate(models: {Feedback: Feedback, RenderedQuest: RenderedQuest, User: User}) {
    this.feedback = models.Feedback;
    this.rendered = models.RenderedQuest;
    this.user = models.User;
  }

  get(partition: string, id: string): Bluebird<QuestInstance|null> {
    return this.s.authenticate()
      .then(() => {
        return this.model.findOne({where: {partition, id} as any})
      });
  }

  resolveInstance(q: QuestInstance): QuestAttributes {
    return new QuestAttributes((q as any).dataValues);
  }

  search(userId: string, params: QuestSearchParams): Bluebird<QuestInstance[]> {
    // TODO: Validate search params
    const where: Sequelize.WhereOptions<Partial<QuestAttributes>> = {published: {$ne: null}, tombstone: null} as any;

    where.partition = params.partition || PUBLIC_PARTITION;

    if (params.id) {
      where.id = params.id;
    }

    // Require results to be published if we're not querying our own quests
    if (params.owner) {
      where.userid = params.owner;
    }

    if (params.players) {
      where.minplayers = {$lte: params.players};
      where.maxplayers = {$gte: params.players};
    }

    // DEPRECATED from app 6/10/17 (also in schemas.js)
    if (params.text && params.text !== '') {
      const text = '%' + params.text.toLowerCase() + '%';
      (where as Sequelize.AnyWhereOptions).$or = [
        Sequelize.where(Sequelize.fn('LOWER', Sequelize.col('title')), {$like: text}),
        Sequelize.where(Sequelize.fn('LOWER', Sequelize.col('author')), {$like: text}),
      ];
    }

    if (params.age) {
      where.published = {$gt: Date.now() - params.age};
    }

    if (params.mintimeminutes) {
      where.mintimeminutes = {$gte: params.mintimeminutes};
    }

    if (params.maxtimeminutes) {
      where.maxtimeminutes = {$lte: params.maxtimeminutes};
    }

    if (params.contentrating) {
      where.contentrating = params.contentrating;
    }

    if (params.genre) {
      where.genre = params.genre;
    }

    if (params.language) {
      where.language = params.language;
    }

    const order = [];
    if (params.order) {
      if (params.order === '+ratingavg') {
        order.push(Sequelize.literal(`
          CASE
            WHEN ratingcount < 5 THEN 0
            ELSE ratingavg
          END DESC NULLS LAST`));
      } else {
        order.push([params.order.substr(1), (params.order[0] === '+') ? 'ASC' : 'DESC']);
      }
    }

    // Hide expansion if searching & not specified, otherwise prioritize results
    // that have the expansion as a secondary sort
    if (!params.id) {
      if (!params.expansions || params.expansions.indexOf('horror') === -1) {
        where.expansionhorror =  {$not: true};
      } else {
        order.push(['expansionhorror', 'DESC']);
      }
    }

    const limit = Math.min(Math.max(params.limit || MAX_SEARCH_LIMIT, 0), MAX_SEARCH_LIMIT);

    return this.model.findAll({where, order, limit});
  }

  publish(userid: string, majorRelease: boolean, params: Partial<QuestAttributes>, xml: string): Bluebird<QuestInstance> {
    // TODO: Validate XML via crawler
    if (!userid) {
      return Bluebird.reject(new Error('Could not publish - no user id.'));
    }
    if (!xml) {
      return Bluebird.reject(new Error('Could not publish - no xml data.'));
    }

    let quest: QuestInstance;
    let isNew: boolean = false;
    return this.s.authenticate()
      .then(() => {
        return this.model.findOne({where: {id: params.id, partition: params.partition}});
      })
      .then((q: QuestInstance) => {
        isNew = !Boolean(q);
        quest = q || this.model.build(params);

        if (isNew && quest.get('partition') === PUBLIC_PARTITION) {
          // If this is a newly published quest, email us!
          // We don't care if this fails.
          Mail.send(['expedition+newquest@fabricate.io'],
            `New quest published: ${params.title} (${params.partition}, ${params.language})`,
            `Summary: ${params.summary}.\n
            By ${params.author}, for ${params.minplayers} - ${params.maxplayers} players over ${params.mintimeminutes} - ${params.maxtimeminutes} minutes. ${params.genre}.
            ${params.expansionhorror ? 'Requires The Horror expansion.' : 'No expansions required.'}`);

          // New publish on public = 100 loot point award
          this.user.get(userid)
            .then((u: UserAttributes) => {
              u.loot_points = (u.loot_points || 0) + 100;
              this.user.upsert(u);
            });

          // If this is the author's first published quest, email them a congratulations
          this.model.findOne({where: {userid}})
            .then((q: QuestInstance) => {
              if (!Boolean(q)) {
                const to = ['expedition+newquest@fabricate.io'];
                if (params.email) {
                  to.push(params.email);
                }
                Mail.send(to,
                  'Congratulations on publishing your first quest!',
                  `<p>${params.author},</p>
                  <p>Congratulations on publishing your first Expedition quest!</p>
                  <p>For all of the adventurers across the world, thank you for sharing your story with us - we can't wait to play it!</p>
                  <p>And remember, if you have any questions or run into any issues, please don't hesistate to email <a href="mailto:Authors@Fabricate.io"/>Authors@Fabricate.io</a></p>
                  <p>Sincerely,</p>
                  <p>Todd, Scott & The Expedition Team</p>`);
              }
            });
        }

        const updateValues: Partial<QuestAttributes> = {
          ...params,
          userid, // Not included in the request - pull from auth
          questversion: (quest.get('questversion') || 0) + 1,
          publishedurl: `http://quests.expeditiongame.com/raw/${quest.get('partition')}/${quest.get('id')}/${quest.get('questversion')}`,
          tombstone: undefined, // Remove tombstone
          published: new Date(),
        };
        if (majorRelease) {
          updateValues.questversionlastmajor = updateValues.questversion;
          updateValues.created = new Date();
        }

        // Publish to RenderedQuests
        this.rendered.model.create({
          partition: params.partition,
          id: params.id,
          questversion: updateValues.questversion,
          xml
        })
        .then(() => {
          console.log(`Stored XML for quest ${params.id} in RenderedQuests`);
        });

        return quest.update(updateValues);
      });
  };

  unpublish(partition: string, id: string): Bluebird<any> {
    return this.s.authenticate()
      .then(() => {
        return this.model.update({tombstone: new Date()} as any, {where: {partition, id}, limit: 1})
      });
  }

  republish(partition: string, id: string): Bluebird<any> {
    return this.s.authenticate()
      .then(() => {
        return this.model.update({tombstone: null} as any, {where: {partition, id}, limit: 1})
      });
  }

  updateRatings(partition: string, id: string): Bluebird<QuestInstance> {
    let quest: QuestInstance;
    return this.s.authenticate()
      .then(() => {
        return this.model.findOne({where: {partition, id}});
      })
      .then((q: QuestInstance) => {
        quest = q;
        return this.feedback.getByQuestId(partition, quest.get('id'));
      })
      .then((feedback: FeedbackInstance[]) => {
        const ratings: number[] = feedback.filter((f: FeedbackInstance) => {
          if (f.get('tombstone')) {
            return false;
          }
          if (!quest.get('questversionlastmajor')) {
            return true;
          }
          if (!f.get('questversion') || !f.get('rating')) {
            return false;
          }
          return (f.get('questversion') >= quest.get('questversionlastmajor'));
        }).map((f: FeedbackInstance) => {
          if (f.get('rating') === undefined || f.get('rating') === null) {
            // typescript isn't quite smart enough to realize we already filtered
            // out any null ratings. We add this here to appease it.
            throw Error('Failed to filter out null ratings');
          }
          return f.get('rating');
        });
        const ratingcount = ratings.length;
        if (ratingcount === 0) {
          return quest.update({ratingcount: null, ratingavg: null});
        }

        const ratingavg = ratings.reduce((a: number, b: number) => { return a + b; }) / ratings.length;
        return quest.update({ratingcount, ratingavg});
      });
  }
}
