import * as Sequelize from 'sequelize'
import * as Bluebird from 'bluebird'

export interface EventAttributes {
  session: number;
  id: number;
  type: string;
  json: string;
}

export interface EventInstance extends Sequelize.Instance<EventAttributes> {
  dataValues: EventAttributes;
}

export type EventModel = Sequelize.Model<EventInstance, EventAttributes>;

export class Event {
  protected s: Sequelize.Sequelize;
  public model: EventModel;

  constructor(s: Sequelize.Sequelize) {
    this.s = s;
    this.model = (this.s.define('Events', {
      session: {
        type: Sequelize.BIGINT,
        allowNull: false,
        primaryKey: true,
      },
      id: {
        type: Sequelize.BIGINT,
        allowNull: false,
        primaryKey: true,
      },
      type: {
        type: Sequelize.STRING(32),
        allowNull: false,
      },
      json: {
        type: Sequelize.TEXT(),
      },
    }, {
      timestamps: true,
      underscored: true,
    }) as EventModel);
  }

  public associate(models: any) {}

  /*
  public get(session: string, id: string): Bluebird<EventInstance> {
    return this.s.authenticate()
      .then(() => {
        return null; //this.model.findOne({where: {session, id}});
      })
      .then((result: EventInstance) => {
        if (!result) {
          throw new Error('Event not found');
        }
        return result;
      });
  }
  */

  public upsert(attrs: EventAttributes): Bluebird<boolean> {
    return this.model.upsert(attrs);
  }

  public getLast(session: string): Bluebird<EventInstance> {
    return this.model.findOne({
      where: {session},
      order: ['created_at', 'DESC']
    });
  }
}

