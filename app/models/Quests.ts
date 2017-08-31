import * as Sequelize from 'sequelize'
import {Feedback, FeedbackInstance} from './Feedback'

import * as CloudStorage from '../lib/cloudstorage'
import * as Mail from '../mail'
import * as Bluebird from 'bluebird';

export const MAX_SEARCH_LIMIT = 100;

export interface QuestAttributes {
  partition?: string;
  id?: string;
  questversion?: number;
  questversionlastmajor?: number;
  engineversion?: string;
  publishedurl?: string;
  userid?: string;
  author?: string;
  email?: string;
  maxplayers?: number;
  maxtimeminutes?: number;
  minplayers?: number;
  mintimeminutes?: number;
  summary?: string;
  title?: string;
  url?: string;
  familyfriendly?: boolean;
  ratingavg?: number;
  ratingcount?: number;
  genre?: string;
  contentrating?: string;
  created?: Date;
  published?: Date;
  tombstone?: Date;
}

export interface QuestSearchParams {
  id?: string;
  owner?: string;
  players?: number;
  search?: string;
  text?: string;
  age?: number;
  mintimeminutes?: number;
  maxtimeminutes?: number;
  contentrating?: string;
  genre?: string;
  order?: string;
  limit?: number;
}

export interface QuestInstance extends Sequelize.Instance<QuestAttributes> {
  dataValues: QuestAttributes;
}

export type QuestModel = Sequelize.Model<QuestInstance, QuestAttributes>;

export class Quest {
  protected s: Sequelize.Sequelize;
  protected mc: any;
  protected feedback: Feedback;
  public model: QuestModel;

  constructor(s: Sequelize.Sequelize) {
    this.s = s;
    this.model = this.s.define<QuestInstance, QuestAttributes>('quests', {
      partition: {
        type: Sequelize.STRING(32),
        allowNull: false,
        primaryKey: true,
      },
      id: {
        type: Sequelize.STRING(255),
        allowNull: false,
        primaryKey: true,
      },
      questversion: {
        type: Sequelize.INTEGER,
        defaultValue: 1,
      },
      questversionlastmajor: {
        type: Sequelize.INTEGER,
        defaultValue: 1,
      },
      engineversion: Sequelize.STRING(128),
      publishedurl: Sequelize.STRING(2048),
      userid: Sequelize.STRING(255),
      author: Sequelize.STRING(255),
      email: Sequelize.STRING(255),
      maxplayers: Sequelize.INTEGER,
      maxtimeminutes: Sequelize.INTEGER,
      minplayers: Sequelize.INTEGER,
      mintimeminutes: Sequelize.INTEGER,
      summary: Sequelize.STRING(1024),
      title: Sequelize.STRING(255),
      url: Sequelize.STRING(2048),
      familyfriendly: Sequelize.BOOLEAN,
      ratingavg: Sequelize.DECIMAL(4, 2),
      ratingcount: Sequelize.INTEGER,
      genre: Sequelize.STRING(128),
      contentrating: Sequelize.STRING(128),
      created: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.NOW,
      },
      published: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.NOW,
      },
      tombstone: Sequelize.DATE,
    }, {
      timestamps: false, // TODO: eventually switch to sequelize timestamps
      underscored: true,
    });
  }

  associate(models: {Feedback: Feedback}) {
    this.feedback = models.Feedback;
  }

  get(partition: string, id: string): Bluebird<QuestInstance> {
    return this.s.authenticate()
      .then(() => {
        return this.model.findOne({where: {partition, id}})
      });
  }

  // TODO: SearchParams interface
  search(partition: string, userId: string, params: QuestSearchParams): Bluebird<QuestInstance[]> {
    // TODO: Validate search params
    const where: Sequelize.WhereOptions<QuestAttributes> = {partition, published: {$ne: null}, tombstone: null};

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
    (where as Sequelize.AnyWhereOptions).$and = [];
    if (params.search) {
      console.log(params);
      console.log(params.search);
      const search = '%' + params.search.toLowerCase() + '%';
      (where as any).$and.push(Sequelize.where(Sequelize.fn('LOWER', 'title'), {$like: search}));
    }

    if (params.text && params.text !== '') {
      const text = '%' + params.text.toLowerCase() + '%';
      (where as any).$and.push(Sequelize.where(Sequelize.fn('LOWER', 'title'), {$like: text}));
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

    const limit = Math.min(Math.max(params.limit || MAX_SEARCH_LIMIT, 0), MAX_SEARCH_LIMIT);

    return this.model.findAll({where, order, limit});
  }

  publish(userid: string, majorRelease: boolean, params: QuestAttributes, xml: string): Bluebird<QuestInstance> {
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
        return this.model.findOne({where: {id: params.id}});
      })
      .then((q: QuestInstance) => {
        isNew = !Boolean(q);
        quest = q || this.model.build(params);

        const cloudStorageData = {
          gcsname: userid + '/' + quest.dataValues.id + '/' + Date.now() + '.xml',
          buffer: xml
        };

        // Run the update in parallel with the Datastore model now that we know the update is valid.
        CloudStorage.upload(cloudStorageData, (err: Error) => {
          if (err) {
            console.log(err);
          }
        });
        const publishedurl = CloudStorage.getPublicUrl(cloudStorageData.gcsname);
        console.log('Uploading to URL ' + publishedurl);

        if (isNew) {
          // If this is a newly published quest, email us!
          // We don't care if this fails.
          const message = `Summary: ${params.summary}. By ${params.author}, for ${params.minplayers} - ${params.maxplayers} players.`;
          Mail.send('expedition+newquest@fabricate.io', 'New quest published: ' + params.title, message);
        }

        const updateValues: QuestAttributes = {
          ...params,
          questversion: (quest.dataValues.questversion || 0) + 1,
          publishedurl,
        };
        if (majorRelease) {
          updateValues.questversionlastmajor = updateValues.questversion;
        }
        return quest.update(updateValues);
      });
  };

  unpublish(partition: string, id: string): Bluebird<any> {
    return this.s.authenticate()
      .then(() => {
        return this.model.update({tombstone: new Date()}, {where: {partition, id}, limit: 1})
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
        return this.feedback.getByQuestId(partition, quest.dataValues.id);
      })
      .then((feedback: FeedbackInstance[]) => {
        const ratings = feedback.filter((f: FeedbackInstance) => {
          return (f.dataValues.questversion >= quest.dataValues.questversionlastmajor);
        }).map((f: FeedbackInstance) => {
          return f.dataValues.rating;
        });
        const ratingcount = ratings.length;
        const ratingavg = ratings.reduce((a: number, b: number) => { return a + b; }) / ratings.length;
        return quest.update({ratingcount, ratingavg});
      });
  }
}