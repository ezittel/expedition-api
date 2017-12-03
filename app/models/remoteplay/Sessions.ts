import * as Sequelize from 'sequelize'
import * as Bluebird from 'bluebird'
import {SessionClient} from './SessionClients'
import {Event} from './Events'
import {RemotePlayEvent} from 'expedition-qdl/lib/remote/Events'
import {makeSecret} from 'expedition-qdl/lib/remote/Session'

export interface SessionAttributes {
  id: number;
  secret: string;
  eventCounter: number;
  locked: boolean;
}

export interface SessionInstance extends Sequelize.Instance<SessionAttributes> {
  dataValues: SessionAttributes;
}

export type SessionModel = Sequelize.Model<SessionInstance, SessionAttributes>;

export class Session {
  protected s: Sequelize.Sequelize;
  public model: SessionModel;
  private sessionClient: SessionClient;
  private event: Event;

  constructor(s: Sequelize.Sequelize) {
    this.s = s;
    this.model = (this.s.define('Sessions', {
      id: {
        type: Sequelize.BIGINT,
        allowNull: false,
        primaryKey: true,
      },
      secret: {
        type: Sequelize.STRING(32),
        allowNull: false,
      },
      eventCounter: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      locked: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
      }
    }, {
      timestamps: false, // TODO: eventually switch to sequelize timestamps
      underscored: true,
    }) as SessionModel);
  }

  public associate(models: any) {
    this.sessionClient = models.SessionClient;
    this.event = models.Event;
  }

  public get(id: string): Bluebird<SessionInstance> {
    return this.s.authenticate()
      .then(() => {
        return this.model.findOne({where: {id}})
      })
      .then((result: SessionInstance) => {
        if (!result) {
          throw new Error('Session not found');
        }
        return result;
      });
  }

  public getBySecret(secret: string): Bluebird<SessionInstance> {
    return this.s.authenticate()
      .then(() => {
        return this.model.findOne({where: {secret, locked: false}});
      })
      .then((result: SessionInstance) => {
        if (!result) {
          throw new Error('Session not found');
        }
        return result;
      });
  }

  public create(): Bluebird<SessionInstance> {
    return this.model.create({
      id: Date.now(),
      secret: makeSecret(),
      eventCounter: 0,
      locked: false,
    });
  }

  public joinSession(secret: string, client: string): Bluebird<SessionInstance> {
    return Bluebird.reject(null);
  }

  public commitEvent(session: number, event: number, type: string, json: string): Bluebird<Sequelize.Transaction> {
    return this.s.transaction((txn: Sequelize.Transaction) => {
      return this.model.findOne({where: {id: session}, transaction: txn})
        .then((s: SessionInstance) => {
          if (!s) {
            throw new Error('unknown session');
          }
          if ((s.dataValues.eventCounter + 1) !== event) {
            throw new Error('eventCounter increment mismatch');
          }
          return s.update({eventCounter: event}, {transaction: txn});
        })
        .then(() => {
          return this.event.model.upsert({
            session,
            id: event,
            type,
            json,
          }, {transaction: txn});
        });
    });
  }
}
