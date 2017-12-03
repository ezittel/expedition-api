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

  public commitEvent(event: RemotePlayEvent): Bluebird<void> {
    return Bluebird.reject(null);
    /*
    return .transaction((txn: Sequelize.Transaction) => {
      //return Session.
      return;
    })
    .then(() => {

    })
    .catch((error: Error) => {
      // TODO
    });
    */

    // Each client owns a counter (/sessions/X/clients/<client_id>.eventCounter) that updates
      // every time they write an event. In this transaction, all eventCounters are read
      // before this client's counter is incremented and the event is written.
      //
      // If (according to the server) another client sends an event before this client sends theirs,
      // this event is never written and we must rewind state to reflect the other client's actions.
      /*
      db.runTransaction((txn) => {
        return Promise.all(this.sessionClientIDs.map((c: ClientID) => {
          return txn.get(this.sessionRef.collection('clients').doc(c)).then((ref) => {
            return [c, ref.data().eventCounter];
          });
        })).then((counters) => {
          console.log(counters);
          for (const c of counters) {
            if (c[0] === this.id) {
              return null; // txn.update(this.sessionRef.collection('clients').doc(c[0]), {eventCounter: c[1]+1});
            }
          }
          throw new Error('Could not find self client ID in eventCounters');
        }).then((result) => {
          return null; //return txn.set(this.sessionRef.collection('events').doc(), event);
        });
        */
  }
}

