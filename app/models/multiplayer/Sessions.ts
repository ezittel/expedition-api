import * as Sequelize from 'sequelize'
import * as Bluebird from 'bluebird'
import {SessionClient} from './SessionClients'
import {Event, EventInstance} from './Events'
import {makeSecret} from 'expedition-qdl/lib/multiplayer/Session'
import {Session as SessionAttributes} from 'expedition-qdl/lib/schema/multiplayer/Sessions'
import {toSequelize} from '../Schema'

const SessionSequelize = toSequelize(new SessionAttributes({id: 0, secret: '', eventCounter: 0, locked: false}));

export interface SessionInstance extends Sequelize.Instance<SessionAttributes> {}

export type SessionModel = Sequelize.Model<SessionInstance, SessionAttributes>;

export class Session {
  protected s: Sequelize.Sequelize;
  public model: SessionModel;
  private sessionClient: SessionClient;
  private event: Event;

  constructor(s: Sequelize.Sequelize) {
    this.s = s;
    this.model = (this.s.define('sessions', SessionSequelize, {
      timestamps: true,
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
    return this.model.create(new SessionAttributes({
      id: Date.now(),
      secret: makeSecret(),
      eventCounter: 0,
      locked: false,
    }));
  }

  public getLargestEventID(session: number): Bluebird<number> {
    return this.event.getLast(session).then((e: EventInstance|null) => {
      if (e === null) {
        return 0;
      }
      return parseInt(e.get('id'), 10);
    });
  }

  public getOrderedAfter(session: number, start: number): Bluebird<EventInstance[]> {
    return this.event.getOrderedAfter(session, start);
  }

  public commitEventWithoutID(session: number, client: string, instance: string, type: string, struct: Object): Bluebird<number|null> {
    // Events by the server may need to be committed without a specific set ID.
    // In these cases, we pass the full object before serialization and fill it
    // with the next available event ID.
    let s: SessionInstance;
    let id: number;
    return this.s.transaction((txn: Sequelize.Transaction) => {
      return this.model.findOne({where: {id: session}, transaction: txn})
        .then((sessionInstance: SessionInstance) => {
          if (!sessionInstance) {
            throw new Error('unknown session');
          }
          s = sessionInstance;
          return this.event.getLast(session);
        })
        .then((eventInstance: EventInstance|null) => {
          if (eventInstance !== null &&
              eventInstance.get('client') === client &&
              eventInstance.get('instance') === instance &&
              eventInstance.get('type') === type &&
              eventInstance.get('json') === JSON.stringify(struct)) {
            console.log('Trivial txn: ' + event + ' already committed for client ' + client + ' instance ' + instance);
            id = s.get('eventcounter');
            (struct as any).id = id;
            return false;
          }

          id = s.get('eventcounter') + 1;
          (struct as any).id = id;
          return s.update({eventcounter: id}, {transaction: txn}).then(() => {return true;});
        })
        .then((incremented: boolean) => {
          if (!incremented) {
            // Skip upsert if we didn't increment the event counter
            return false;
          }
          return this.event.model.upsert({
            session,
            client,
            instance,
            timestamp: new Date(),
            id,
            type,
            json: JSON.stringify(struct),
          }, {transaction: txn, returning:false});
        });
    }).then((updated: boolean) => {
      return id;
    });
  }

  public commitEvent(session: number, client: string, instance: string, event: number, type: string, json: string): Bluebird<number|null> {
    let s: SessionInstance;
    return this.s.transaction((txn: Sequelize.Transaction) => {
      return this.model.findOne({where: {id: session}, transaction: txn})
        .then((sessionInstance: SessionInstance) => {
          if (!sessionInstance) {
            throw new Error('unknown session');
          }
          s = sessionInstance;
          return this.event.getById(session, event);
        })
        .then((eventInstance: EventInstance|null) => {
          if (eventInstance !== null &&
              eventInstance.get('client') === client &&
              eventInstance.get('instance') === instance &&
              eventInstance.get('type') === type &&
              eventInstance.get('json') === json) {
            // The client does retry requests - if we've already successfully
            // committed this event, return success and don't try to commit it again.
            console.log('Trivial txn: ' + event + ' already committed for client ' + client + ' instance ' + instance);
            return false;
          } else if ((s.get('eventcounter') + 1) !== event) {
            throw new Error('eventcounter increment mismatch');
          }
          return s.update({eventcounter: event}, {transaction: txn}).then(() => {return true;});
        })
        .then((incremented: boolean) => {
          if (!incremented) {
            // Skip upsert if we didn't increment the event counter
            return false;
          }
          if (event === null) {
            throw new Error('Found null event after it should be set');
          }
          return this.event.model.upsert({
            session,
            client,
            instance,
            timestamp: new Date(),
            id: event,
            type,
            json,
          }, {transaction: txn, returning:false});
        });
    }).then((updated: boolean) => {
      return (updated) ? event : null;
    });
  }
}

