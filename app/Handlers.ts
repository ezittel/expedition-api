import * as express from 'express'
import {Quest, QuestInstance, QuestAttributes, QuestSearchParams, MAX_SEARCH_LIMIT, PUBLIC_PARTITION} from './models/Quests'
import {Feedback, FeedbackType, FeedbackAttributes} from './models/Feedback'
import broker from './remoteplay/Broker'
import {Session} from 'expedition-qdl/lib/remote/Broker'
import {SessionID} from 'expedition-qdl/lib/remote/Broker'

const Joi = require('joi');

const GENERIC_ERROR_MESSAGE = 'Something went wrong. Please contact support by emailing Expedition@Fabricate.io';

export function healthCheck(req: express.Request, res: express.Response) {
  res.send(' ');
}

export function announcement(req: express.Request, res: express.Response) {
  res.json({
    message: 'November: $500 Quest Writing Contest',
    link: 'https://expeditiongame.com/writing-contests',
  });
}

export function search(quest: Quest, req: express.Request, res: express.Response) {
  if (!res.locals || !res.locals.id) {
    return res.send(JSON.stringify([]));
  }
  let body: any;
  try {
    body = JSON.parse(req.body);
  } catch (e) {
    return res.status(500).end('Error reading request.');
  }
  const params: QuestSearchParams = {
    id: body.id,
    owner: body.owner,
    players: body.players,
    search: body.search,
    text: body.text,
    age: body.age,
    mintimeminutes: body.mintimeminutes,
    maxtimeminutes: body.maxtimeminutes,
    contentrating: body.contentrating,
    genre: body.genre,
    order: body.order,
    limit: body.limit,
    partition: body.partition || PUBLIC_PARTITION,
    expansions: body.expansions,
  };
  quest.search(res.locals.id, params)
    .then((quests: QuestInstance[]) => {
      const results = quests.map((q: QuestInstance) => {
        return q.dataValues;
      });

      console.log('Found ' + quests.length + ' quests for user ' + res.locals.id);
      res.send(JSON.stringify({
        error: null,
        quests: results,
        hasMore: (quests.length === (params.limit || MAX_SEARCH_LIMIT))}));
    })
    .catch((e: Error) => {
      console.error(e);
      return res.status(500).send(GENERIC_ERROR_MESSAGE);
    });
}

export function questXMLRedirect(quest: Quest, req: express.Request, res: express.Response) {
  quest.get(PUBLIC_PARTITION, req.params.quest)
    .then((quest: QuestInstance) => {
      res.header('Content-Type', 'text/xml');
      res.header('Location', quest.dataValues.url);
      res.status(301).end();
    })
    .catch((e: Error) => {
      console.error(e);
      return res.status(500).send(GENERIC_ERROR_MESSAGE);
    });
}

export function publish(quest: Quest, req: express.Request, res: express.Response) {
  if (!res.locals.id) {
    return res.status(500).end('You are not signed in. Please sign in (by refreshing the page) to save your quest.');
  }

  const attribs: QuestAttributes = {
    id: req.params.id,
    partition: req.query.partition || PUBLIC_PARTITION,
    title: req.query.title,
    summary: req.query.summary,
    author: req.query.author,
    email: req.query.email,
    minplayers: req.query.minplayers,
    maxplayers: req.query.maxplayers,
    mintimeminutes: req.query.mintimeminutes,
    maxtimeminutes: req.query.maxtimeminutes,
    genre: req.query.genre,
    contentrating: req.query.contentrating,
    expansionhorror: req.query.expansionhorror || false,
  };
  const majorRelease = req.query.majorRelease || false;

  quest.publish(res.locals.id, majorRelease, attribs, req.body)
    .then((quest: QuestInstance) => {
      console.log('Published quest ' + quest.dataValues.id);
      res.end(quest.dataValues.id);
    })
    .catch((e: Error) => {
      console.error(e);
      return res.status(500).send(GENERIC_ERROR_MESSAGE);
    })
}

export function unpublish(quest: Quest, req: express.Request, res: express.Response) {
  if (!res.locals.id) {
    return res.status(500).end('You are not signed in. Please sign in (by refreshing the page) to save your quest.');
  }

  quest.unpublish(PUBLIC_PARTITION, req.params.quest)
    .then(() => {
      res.end('ok');
    })
    .catch((e: Error) => {
      console.error(e);
      return res.status(500).send(GENERIC_ERROR_MESSAGE);
    });
}

export function feedback(feedback: Feedback, req: express.Request, res: express.Response) {

  const type: FeedbackType = req.params.type;
  if (req.params.type !== 'rating' && req.params.type !== 'report') {
    return res.status(500).end('Unknown feedback type: ' + req.params.type);
  }

  let body: any;
  try {
    body = JSON.parse(req.body);
  } catch (e) {
    return res.status(500).end('Error reading request.');
  }
  const attribs: FeedbackAttributes = {
    partition: body.partition || PUBLIC_PARTITION,
    questid: body.questid,
    userid: body.userid,
    questversion: body.questversion,
    created: body.created,
    rating: body.rating,
    text: body.text,
    email: body.email,
    name: body.name,
    difficulty: body.difficulty,
    platform: body.platform,
    players: body.players,
    version: body.version,
  }

  feedback.submit(type, attribs)
    .then((id: string) => {
      res.end('ok');
    }).catch((e: Error) => {
      console.error(e);
      return res.status(500).send(GENERIC_ERROR_MESSAGE);
    });
}

export function subscribe(mailchimp: any, listId: string, req: express.Request, res: express.Response) {
  req.body = JSON.parse(req.body);
  Joi.validate(req.body.email, Joi.string().email().invalid(''), (err: Error, email: string) => {

    if (err) {
      return res.status(400).send('Valid email address required.');
    }

    // TODO: Move this logic into the mail.ts file.
    if (!mailchimp) {
      return res.status(200).send();
    } else {
      mailchimp.post('/lists/' + listId + '/members/', {
        email_address: email,
        status: 'pending',
        merge_fields: {
          SOURCE: 'app',
        },
      }, (result: any, err: Error) => {
        if (err) {
          const status = (err as any).status;
          if (status === 400) {
            return res.status(200).send(); // Already on the list - but that's ok!
          } else {
            console.log('Mailchimp error', err);
            return res.status(status).send((err as any).title);
          }
        }
        console.error(email + ' subscribed as pending to player list');
        return res.status(200).send();
      });
    }
  });
}

export function remotePlayUser(req: express.Request, res: express.Response) {
  broker.fetchSessionsByClient(req.params.id).then((fetched: Session[]) => {
    //const history = fetched.map((s) => { return sessions.getMetadata(s.id); }).filter((s) => {return s !== null;});
    //TODO: reply({history});
    res.status(200).send(JSON.stringify({history: [
      {id: 5, peerCount: 3, questTitle: 'Test Quest', firstContact: new Date()},
      {id: 6, peerCount: 1, questTitle: 'A Quest for Two', firstContact: new Date((new Date()).valueOf() - 65*60)},
    ]}));
  })
  .catch((e: Error) => {
    return res.status(500).send(JSON.stringify({error: 'Error looking up user details: ' + e.toString()}));
  });
}

export function remotePlayNewSession(req: express.Request, res: express.Response) {
  broker.createSession().then((s: Session) => {
    console.log('Created session');
    console.log(s);
    res.status(200).send(JSON.stringify({secret: s.secret}));
  })
  .catch((e: Error) => {
    return res.status(500).send(JSON.stringify({error: 'Error creating session: ' + e.toString()}));
  });
}

export function remotePlayConnect(req: express.Request, res: express.Response) {
  let body: any;
  try {
    body = JSON.parse(req.body);
  } catch (e) {
    return res.status(500).end('Error reading request.');
  }
  let session: number;
  const clientID = 'test' + Date.now();
  broker.joinSession(clientID, body.secret)
    .then((s: SessionID) => {
      session = s;
      return broker.createAuthToken(clientID);
    })
    .then((authToken: string) => {
      return res.status(200).send(JSON.stringify({session, authToken}));
    })
    .catch((e: Error) => {
      return res.status(500).send(JSON.stringify({error: 'Could not join session: ' + e.toString()}));
    });
}
