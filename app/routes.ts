import * as express from 'express'
import Config from './config'
import * as Mail from './Mail'
import * as oauth2 from './lib/oauth2'
import * as Handlers from './Handlers'
import {models} from './models/Database'

const Cors = require('cors');

const querystring = require('querystring');
const RateLimit = require('express-rate-limit');

const Mailchimp = require('mailchimp-api-v3');
const mailchimp = (Config.get('NODE_ENV') !== 'dev' && Config.get('MAILCHIMP_KEY')) ? new Mailchimp(Config.get('MAILCHIMP_KEY')) : null;

// Use the oauth middleware to automatically get the user's profile
// information and expose login/logout URLs to templates.
const router = express.Router();
router.use(oauth2.template);

const limitCors = Cors({
  credentials: true,
  // allows expedition domains, localhost and file (for dev + mobile apps)
  origin: /(expedition(game|rpg)\.com$)|(localhost(:[0-9]+)?$)|(^file:\/\/)/i,
  optionsSuccessStatus: 200, // some legacy browsers (IE11, various SmartTVs) choke on 204
});

const publishLimiter = new RateLimit({
  windowMs: 60*1000, // 1 minute window
  delayAfter: 2, // begin slowing down responses after the second request
  delayMs: 3*1000, // slow down subsequent responses by 3 seconds per request
  max: 5, // start blocking after 5 requests
  message: 'Publishing too frequently. Please wait 1 minute and then try again',
});

router.get('/healthcheck', limitCors, Handlers.healthCheck);
router.get('/announcements', limitCors, Handlers.announcement);
router.post('/quests', limitCors, (req, res) => {Handlers.search(models.Quest, req, res);});
router.get('/raw/:quest', limitCors, (req, res) => {Handlers.questXMLRedirect(models.Quest, req, res);});
router.post('/publish/:id', publishLimiter, limitCors, (req, res) => {Handlers.publish(models.Quest, req, res);});
router.post('/unpublish/:quest', limitCors, (req, res) => {Handlers.unpublish(models.Quest, req, res);});
router.post('/quest/feedback/:type', limitCors, (req, res) => {Handlers.feedback(models.Feedback, req, res);});
router.post('/user/subscribe', limitCors, (req, res) => {Handlers.subscribe(mailchimp, Config.get('MAILCHIMP_PLAYERS_LIST_ID'), req, res);});

export default router;
