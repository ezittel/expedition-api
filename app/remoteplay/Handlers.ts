import * as express from 'express'
import * as Sequelize from 'sequelize'
import {Session, SessionID, SessionMetadata} from 'expedition-qdl/lib/remote/Session'
import {Session as SessionModel, SessionInstance} from '../models/remoteplay/Sessions'
import {SessionClient, SessionClientInstance} from '../models/remoteplay/SessionClients'
import {ClientID, RemotePlayEvent} from 'expedition-qdl/lib/remote/Events'
import {InflightCommitAction, InflightRejectAction} from './Actions'
import * as url from 'url'
import * as http from 'http'

const Joi = require('joi');

const GENERIC_ERROR_MESSAGE = 'Something went wrong. Please contact support by emailing Expedition@Fabricate.io';

export function user(sc: SessionClient, req: express.Request, res: express.Response) {
  if (!res.locals || !res.locals.id) {
    return res.status(500).end('You are not signed in.');
  }

  sc.getSessionsByClient(res.locals.id).then((fetched: any[]) => {
    // TODO Map the data
    /*
      return db.collection('sessions').doc(result.id.toString()).collection('events')
        .orderBy('added', 'desc').limit(1).get()
        .then((events) => {
          if (!events || events.docs.length < 1) {
            return null;
          }
          result.lastAction = events.docs[0].data().added;
          return db.collection('sessions').doc(result.id.toString()).collection('clients').get();
        })
        .then((clients) => {
          if (!clients) {
            return null;
          }
          result.peerCount = clients.docs.length;
          return result;
        });
    */
    console.log('Sessions fetched');
    res.status(200).send(JSON.stringify({history: fetched}));
  })
  .catch((e: Error) => {
    return res.status(500).send(JSON.stringify({error: 'Error looking up user details: ' + e.toString()}));
  });
}

export function newSession(rpSessions: SessionModel, req: express.Request, res: express.Response) {
  if (!res.locals || !res.locals.id) {
    return res.status(500).end('You are not signed in.');
  }

  rpSessions.create().then((s: SessionInstance) => {
    console.log('Created session', s.dataValues.id);
    res.status(200).send(JSON.stringify({secret: s.dataValues.secret}));
  })
  .catch((e: Error) => {
    return res.status(500).send(JSON.stringify({error: 'Error creating session: ' + e.toString()}));
  });
}

export function connect(rpSessions: SessionModel, sessionClients: SessionClient, req: express.Request, res: express.Response) {
  if (!res.locals || !res.locals.id) {
    return res.status(500).end('You are not signed in.');
  }

  let body: any;
  try {
    body = JSON.parse(req.body);
  } catch (e) {
    return res.status(500).end('Error reading request.');
  }

  rpSessions.getBySecret(body.secret)
    .then((session: SessionInstance) => {
      return sessionClients.create(session.dataValues.id, res.locals.id, body.secret);
    })
    .then((sc: SessionClientInstance) => {
      return res.status(200).send(JSON.stringify({session: sc.dataValues.session}));
    })
    .catch((e: Error) => {
      return res.status(500).send(JSON.stringify({
        error: 'Could not join session: ' + e.toString()
      }));
    });
}

export function remotePlayEvent() {
  // Attempt to add a client event to the session.
  // This is done transactionally.
  // TODO
}

function wsParamsFromReq(req: http.ServerRequest) {
  if (!req || !req.url) {
    console.error('req.url not defined');
    console.log(req);
    return null;
  }
  const parsedURL = url.parse(req.url, true);
  const splitPath = parsedURL.pathname.match(/\/ws\/remoteplay\/v1\/session\/(\d+).*/);

  if (splitPath === null) {
    console.error('Invalid upgrade request path, cancelling websocket connection.');
    return null;
  }

  return {
    session: parseInt(splitPath[1], 10),
    client: parsedURL.query.client,
    secret: parsedURL.query.secret
  };
}

export function verifyWebsocket(sessionClients: SessionClient, info: {origin: string, secure: boolean, req: http.ServerRequest}, cb: (result: boolean) => any) {
  const params = wsParamsFromReq(info.req);
  if (params === null) {
    return cb(false);
  }
  sessionClients.verify(params.session, params.client, params.secret)
    .then((verified: boolean) => {
      return cb(verified);
    })
    .catch((e: Error) => {
      console.error(e);
      cb(false);
    });
}

const inMemorySessions: {[sessionID: string]: {[clientID: string]: any}} = {};

export function websocketSession(rpSession: SessionModel, sessionClients: SessionClient, ws: any, req: http.ServerRequest) {
  console.log(req);
  console.log(ws);
  /*
  const params = wsParamsFromReq(req);

  console.log(`Client ${params.client} connected to session ${params.session} with secret ${params.secret}`);

  if (!inMemorySessions[params.session]) {
    inMemorySessions[params.session] = {};
  }
  inMemorySessions[params.session][params.client] = ws;

  // TODO: Broadcast new client to other clients

  ws.on('message', (msg: any) => {
    const event: RemotePlayEvent = JSON.parse(msg);
    rpSession.commitEvent(event)
      .then(() => {
        // Broadcast to all peers
        for(const peerID of Object.keys(inMemorySessions[params.session])) {
          const peerWS = inMemorySessions[params.session][peerID];
          if (peerWS) {
            peerWS.send(msg);
          }
        }
        ws.send(JSON.stringify({
          type: 'INFLIGHT_COMMIT',
          id: event.id,
        } as InflightCommitAction));
      })
      .catch((error: Error) => {
        ws.send(JSON.stringify({
          type: 'INFLIGHT_REJECT',
          id: event.id,
          error: error.toString(),
        } as InflightRejectAction));
      });
  });

  ws.on('close', () => {
    inMemorySessions[params.session][params.client] = null;
    // TODO: Broadcast lost client to other clients
  });
  */
}
