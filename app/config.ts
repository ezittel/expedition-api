const nconf = require('nconf');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '../config.json');

console.log('Loading config from ' + CONFIG_PATH);

nconf
  .argv()
  .env([
    // Quest storage config settings
    'GCLOUD_PROJECT', // This is the id of your project in the Google Cloud Developers Console.
    'CLOUD_BUCKET', // Bucket for compiled quest XML
    'DATABASE_URL', // URL of postgres database storing quest metadata, user data, feedback, etc.
    'GOOGLE_SERVICE_KEY', // Service key for cloud storage

    'FIREBASE_SERVICE_KEY', // Service key for firebase firestore

    // Feedback email sender config settings
    'MAIL_EMAIL',
    'MAIL_PASSWORD',

    // Authentication config settings
    'OAUTH2_CLIENT_ID',
    'OAUTH2_CLIENT_SECRET',

    // Web server config settings
    'PORT',
    'SESSION_SECRET',

    // Monitoring config settings
    'NEW_RELIC_LICENSE_KEY',

    // (Optional) Pay-what-you-want config settings
    'ENABLE_PAYMENT',

    // (Optional) mailing list config settings
    'MAILCHIMP_KEY',
    'MAILCHIMP_CREATORS_LIST_ID',
    'MAILCHIMP_PLAYERS_LIST_ID',

    // Specify prod or dev environment.
    'NODE_ENV',
  ])
  .file({ file: CONFIG_PATH })
  .defaults({
    PORT: 8081,
    ENABLE_PAYMENT: false,

    OAUTH2_CLIENT_ID: '',
    OAUTH2_CLIENT_SECRET: '',
    OAUTH2_CALLBACK: 'http://localhost:8080/auth/google/callback',
  });

// Check for required settings
const REQUIRED_SETTINGS = [
  'GCLOUD_PROJECT',
  'CLOUD_BUCKET',
  'DATABASE_URL',
  'OAUTH2_CLIENT_ID',
  'OAUTH2_CLIENT_SECRET',
  'SESSION_SECRET',
  'GOOGLE_SERVICE_KEY',
  'FIREBASE_SERVICE_KEY',
];

const missing = [];
for (let i = 0; i < REQUIRED_SETTINGS.length; i++) {
  if (!nconf.get(REQUIRED_SETTINGS[i])) {
    missing.push(REQUIRED_SETTINGS[i]);
  }
}
if (missing.length > 0) {
  throw new Error('Cannot find the following config settings:\n\t' + missing.join('\n\t') +
    '\nSet them via environment variable or add them to a config.json file in the repository root.' +
    '\nSee "config-example.json" for an example config with all required fields.\n');
}

export default nconf;
