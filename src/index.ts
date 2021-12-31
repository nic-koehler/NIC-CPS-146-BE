import type { HttpFunction } from '@google-cloud/functions-framework/build/src/functions';
import { Firestore, Timestamp, CollectionReference, DocumentData } from '@google-cloud/firestore';
import querystring from 'querystring';
import axios from 'axios';
import crypto from 'crypto';
import mysql from 'promise-mysql';
import nodemailer from 'nodemailer';
import * as express from 'express';
import { readFileSync } from 'fs';

const synapse_registration_url: string = process.env.SYNAPSE_REGISTRATION_URL || '';
const synapse_registration_shared_secret: string = process.env.SYNAPSE_REGISTRATION_SHARED_SECRET || '';

function generate_mac( shared_secret: string,
                       nonce: string,
                       user: string,
                       password: string,
                       admin=false ) {
  const hmac = crypto.createHmac('sha1', shared_secret);
  hmac.update( nonce );
  hmac.update( '\x00' );
  hmac.update( user );
  hmac.update( '\x00' );
  hmac.update( password );
  hmac.update( '\x00' );
  hmac.update( admin ? 'admin' : 'notadmin' );
  return hmac.digest('hex');
}

// [START cloud_sql_mysql_mysql_create_socket]
const createUnixSocketPool = async (config: any) => {
  //const dbSocketPath = process.env.DB_SOCKET_PATH || '/cloudsql';
  const caPath = process.env.DB_SSL_CA || '/bkstuff/mariadb-ca-cert';
  const certPath = process.env.DB_SSL_CERT || '/bkstuff2/mariadb-client-cert';
  const keyPath = process.env.DB_SSL_KEY || '/bkstuff3/mariadb-client-key';

  // Establish a connection to the database
  return await mysql.createPool({
    host: process.env.DB_HOST, // e.g. 'my-db-host'
    user: process.env.DB_USER, // e.g. 'my-db-user'
    password: process.env.DB_PASS, // e.g. 'my-db-password'
    database: process.env.DB_NAME, // e.g. 'my-database'
    // If connecting via unix domain socket, specify the path
    //socketPath: `${dbSocketPath}/${process.env.CLOUD_SQL_CONNECTION_NAME}`,
    // Specify additional properties here.
    ssl: {
        ca: readFileSync( caPath ),
        cert: readFileSync( certPath ),
        key: readFileSync( keyPath )
    },
    ...config,
  });
};
// [END cloud_sql_mysql_mysql_create_socket]

const createPool = async () => {
  const config = {
    // [START cloud_sql_mysql_mysql_limit]
    // 'connectionLimit' is the maximum number of connections the pool is allowed
    // to keep at once.
    connectionLimit: 5,
    // [END cloud_sql_mysql_mysql_limit]

    // [START cloud_sql_mysql_mysql_timeout]
    // 'connectTimeout' is the maximum number of milliseconds before a timeout
    // occurs during the initial connection to the database.
    connectTimeout: 10000, // 10 seconds
    // 'acquireTimeout' is the maximum number of milliseconds to wait when
    // checking out a connection from the pool before a timeout error occurs.
    acquireTimeout: 10000, // 10 seconds
    // 'waitForConnections' determines the pool's action when no connections are
    // free. If true, the request will queued and a connection will be presented
    // when ready. If false, the pool will call back with an error.
    waitForConnections: true, // Default: true
    // 'queueLimit' is the maximum number of requests for connections the pool
    // will queue at once before returning an error. If 0, there is no limit.
    queueLimit: 0, // Default: 0
    // [END cloud_sql_mysql_mysql_timeout]

    // [START cloud_sql_mysql_mysql_backoff]
    // The mysql module automatically uses exponential delays between failed
    // connection attempts.
    // [END cloud_sql_mysql_mysql_backoff]
  };
  return await createUnixSocketPool(config);

};

const ensureSchema = async (pool: any) => {
  // Wait for tables to be created (if they don't already exist).
  // await pool.query(
  //   `CREATE TABLE IF NOT EXISTS votes
  //     ( vote_id SERIAL NOT NULL, time_cast timestamp NOT NULL,
  //     candidate CHAR(6) NOT NULL, PRIMARY KEY (vote_id) );`
  // );
  console.log("Ensured that table 'votes' exists");
};

const createPoolAndEnsureSchema = async () =>
  await createPool()
    .then(async pool => {
      await ensureSchema(pool);
      return pool;
    })
    .catch(err => {
      console.log(err);
      throw err;
    });

// Set up a variable to hold our connection pool. It would be safe to
// initialize this right away, but we defer its instantiation to ease
// testing different configurations.
let pool: any;

const db = new Firestore({
//  projectId: 'cps-146'
  projectId: process.env.GOOGLE_CLOUD_PROJECT
});

const collection = db.collection('requests');
const collectionMatrix = db.collection('requestsmatrix');
const accounts = db.collection('accounts');

async function createOrUpadateMySQLAccount( account: string, password: string ) {
  pool = pool || (await createPoolAndEnsureSchema());
  const db_name = account + '_db0001';
  const priv_level = db_name + '.*';
  const create_db = 'create database if not exists ' + db_name;
  const grant_all = 'grant all on ' + priv_level + ' to ' + account;
  await pool.query( 'create user if not exists ? identified by ?', [account,password]);
  await pool.query( 'alter user if exists ? identified by ?', [account,password]);
  await pool.query( create_db );
  await pool.query( 'grant select on employees.* to ?', [account]);
  await pool.query( 'grant select on menagerie.* to ?', [account]);
  await pool.query( 'grant select on sakila.* to ?', [account]);
  await pool.query( 'grant select on world_x.* to ?', [account]);
  await pool.query( grant_all );
}

async function getAccountFromEmail( email: string ) {
  const snapshot = await accounts
    .where( 'email', '==', email )
    .get();
  return snapshot;
}

async function getEmailFromToken(token: string, col: CollectionReference<DocumentData> ) {
  let email = '';
  const now = Timestamp.now();
  const oneHourAgo = new Timestamp( now.seconds - 3600, now.nanoseconds );
  const snapshot = await col
    .where( 'token', '==', token )
    .where( 'createdAt', '>', oneHourAgo )
    .limit( 1 )
    .get();
  if ( !snapshot.empty) {
    snapshot.forEach(doc => {
      const result = doc.data();
      email = result.email;
    });
  }
  return email;
}

const CreateAccountRequest = async ( req: express.Request,
                                     res: express.Response,
                                     col: CollectionReference<DocumentData>,
                                     label: string ) => {
  if ( req.body.token && req.body.email ) {
    if ( req.body.email.match(/^.+@nic\.bc\.ca|.+@northislandcollege\.ca|.+@koehler.ca$/) ) {
      const response = await axios.post(
        'https://www.google.com/recaptcha/api/siteverify',
        querystring.stringify({
          secret: process.env.RECAPTCHA_SECRET,
          response: req.body.token
        })
      );
      if ( response.data.success && response.data.score > 0.6 ) {
        const buf = crypto.randomBytes(16);
        const newRequest = {
          email: req.body.email,
          token: buf.toString( 'hex'),
          createdAt: Timestamp.now()
        };
        const docRef = await col.add( newRequest );
        let transporter = nodemailer.createTransport({
          host: "email-smtp.ca-central-1.amazonaws.com",
          port: 587,
          secure: false,
          requireTLS: true,
          auth: {
            user: process.env.SMTP_USER, // AWS SES user
            pass: process.env.SMTP_PASS // AWS SES password
          }
        });
        let info = await transporter.sendMail({
          from: 'no-reply@nic.koehler.ca', // PUT YOUR DOMAIN HERE
          to: req.body.email, // list of receivers
          subject: `Configure Your ${label} Account`, // Subject line
          text: `Follow this link to configure your ${label} account: ` +
            process.env.FRONTEND_URL +
            `/verify-${label}-account/` +
            newRequest.token
        });
        console.log( 'Initiated request for: ' + req.body.email );

      } else {
        console.log( 'recaptcha fail' );
        console.log( response.data );
      }

    } else {
      console.log( 'invalid email' );
      console.log( req.body.email );
    }
  } else {
    console.log( 'missing email or token');
  }
  res.json( {
    message: 'Success'
  } );
}

export const nicMySQL: HttpFunction = async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');

  if ( req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.status(204).send('');

  } else if ( req.method === 'GET' && req.path.startsWith( '/requests/' ) ) {
    const token = req.path.replace ('/requests/', '' );
    const email = await getEmailFromToken( token, collection );
    if ( email ) {
      const accountSnapshot = await getAccountFromEmail( email );
      res.json( {
        message: accountSnapshot.empty ? 'create' : 'update',
        email
      } );
      console.log( 'Fetched valid MySQL request for: ' + email );
      console.log( 'with token: ' + token );
    } else {
      res.json( {
        message: "Invalid or expired MySQL link"
      } );
      console.log( 'Invalid or expired MySQL token: ' + token );
    }

  } else if ( req.method === 'GET' && req.path.startsWith( '/requests-matrix/' ) ) {
    const token = req.path.replace ('/requests-matrix/', '' );
    const email = await getEmailFromToken( token, collectionMatrix );
    if ( email ) {
      res.json( {
        message: 'create',
        email
      } );
      console.log( 'Fetched valid Matrix request for: ' + email );
      console.log( 'with token: ' + token );
    } else {
      res.json( {
        message: "Invalid or expired Matrix link"
      } );
      console.log( 'Invalid or expired Matrix token: ' + token );
    }

  } else if ( req.method === 'POST' && req.path === '/accounts-matrix') {
    let message = 'Matrix: Unknown error.'
    if ( req.body.token && req.body.password ) {
      const email = await getEmailFromToken( req.body.token, collectionMatrix );
      if ( email ) {
        const [account,discard] = email.split( '@', 2 );
        const response = await axios.get( synapse_registration_url );
        const mac = generate_mac(
          synapse_registration_shared_secret,
          response.data.nonce,
          account,
          req.body.password
        );
        const response2 = await axios.post( synapse_registration_url, {
          'nonce': response.data.nonce,
          'username': account,
          'password': req.body.password,
          'mac': mac
        });
        message = `Created Matrix account: ${account} (for ${email})`;
      } else {
        message = 'Matrix: Invalid or expired link.'
      }
    } else {
      message = 'Matrix: Missing token or password.';
    }
    console.log( message )
    res.json( { message } );

  } else if ( req.method === 'POST' && req.path === '/accounts') {
    let message = 'MySQL: Unknown error.'
    if ( req.body.token && req.body.password ) {
      const email = await getEmailFromToken( req.body.token, collection );
      if ( email ) {
        const accountSnapshot = await getAccountFromEmail( email );
        if ( !accountSnapshot.empty ) {
          let lastAccount = '';
          accountSnapshot.forEach(doc => {
            const result = doc.data();
            lastAccount = result.account;
          });
          await createOrUpadateMySQLAccount( lastAccount, req.body.password );
          message = `Updated MySQL account: ${lastAccount} (for ${email})`;
        } else {
          let lastAccount = ''
          const accountSnapshot = await accounts
            .orderBy( 'account', 'desc' )
            .limit( 1 )
            .get();
          let account = 'user0001';
          if ( !accountSnapshot.empty ) {
            let lastAccount = '';
            accountSnapshot.forEach(doc => {
              const result = doc.data();
              lastAccount = result.account;
            });
            let lastNum = lastAccount.substring( 4 )
            let newNum = parseInt( lastNum, 10 ) + 1;
            account = 'user' + newNum.toString().padStart(4, '0');
          }
          const docRef = accounts.add( {
            email,
            account
          } );
          await createOrUpadateMySQLAccount( account, req.body.password );
          message = `Created MySQL account: ${account} (for ${email})`;
        }
      } else {
        message = 'Invalid or expired link.'
      }
    } else {
      message = 'Missing token or password.';
    }
    console.log( message )
    res.json( { message } );

  } else if ( req.method === 'POST' && req.path === '/requests') {
    CreateAccountRequest( req, res, collection, 'MySQL' );

  } else if ( req.method === 'POST' && req.path === '/requests-matrix') {
    CreateAccountRequest( req, res, collectionMatrix, 'Matrix' );

  } else {
    console.log( 'unsupported request');
    console.log( 'method: ' + req.method );
    console.log( 'path: ' + req.path );
    res.status(500).json({
      message: 'unsupported request'
    });

  }
};
