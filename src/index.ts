import type { HttpFunction } from '@google-cloud/functions-framework/build/src/functions';
import { Firestore, Timestamp } from '@google-cloud/firestore';
import querystring from 'querystring';
import axios from 'axios';
import crypto from 'crypto';
import mysql from 'promise-mysql';
import nodemailer from 'nodemailer';

// [START cloud_sql_mysql_mysql_create_socket]
const createUnixSocketPool = async (config: any) => {
  const dbSocketPath = process.env.DB_SOCKET_PATH || '/cloudsql';

  // Establish a connection to the database
  return await mysql.createPool({
    user: process.env.DB_USER, // e.g. 'my-db-user'
    password: process.env.DB_PASS, // e.g. 'my-db-password'
    database: process.env.DB_NAME, // e.g. 'my-database'
    // If connecting via unix domain socket, specify the path
    socketPath: `${dbSocketPath}/${process.env.CLOUD_SQL_CONNECTION_NAME}`,
    // Specify additional properties here.
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
const accounts = db.collection('accounts');

async function createOrUpadateMySQLAccount( account: string, password: string ) {
  pool = pool || (await createPoolAndEnsureSchema());
  await pool.query( 'create user if not exists ? identified by ?', [account,password]);
  await pool.query( 'alter user if exists ? identified by ?', [account,password]);
  await pool.query( 'grant select on employees.* to ?', [account]);
  await pool.query( 'grant select on menagerie.* to ?', [account]);
  await pool.query( 'grant select on sakila.* to ?', [account]);
  await pool.query( 'grant select on world_x.* to ?', [account]);
}

async function getAccountFromEmail( email: string ) {
  const snapshot = await accounts
    .where( 'email', '==', email )
    .get();
  return snapshot;
}

async function getEmailFromToken(token: string) {
  let email = '';
  const now = Timestamp.now();
  const oneHourAgo = new Timestamp( now.seconds - 3600, now.nanoseconds );
  const snapshot = await collection
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

export const nicMySQL: HttpFunction = async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');

  if ( req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.status(204).send('');

  } else if ( req.method === 'GET' && req.path.startsWith( '/requests/' ) ) {
    const token = req.path.replace ('/requests/', '' );
    const email = await getEmailFromToken( token );
    if ( email ) {
      const accountSnapshot = await getAccountFromEmail( email );
      res.json( {
        message: accountSnapshot.empty ? 'create' : 'update',
        email
      } );
    } else {
      res.json( {
        message: "Invalid or expired link"
      } );
    }

  } else if ( req.method === 'POST' && req.path === '/accounts') {
    let message = 'Unknown error.'
    if ( req.body.token && req.body.password ) {
      const email = await getEmailFromToken( req.body.token );
      if ( email ) {
        const accountSnapshot = await getAccountFromEmail( email );
        if ( !accountSnapshot.empty ) {
          let lastAccount = '';
          accountSnapshot.forEach(doc => {
            const result = doc.data();
            lastAccount = result.account;
          });
          await createOrUpadateMySQLAccount( lastAccount, req.body.password );
          message = `Updated account: ${lastAccount}`;
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
          message = `Added new account: ${account}`;
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
    if ( req.body.token && req.body.email ) {
      if ( req.body.email.match(/^.+@nic\.bc\.ca|.+@northislandcollege\.ca|.+@koehler.ca$/) ) {
        const response = await axios.post(
          'https://www.google.com/recaptcha/api/siteverify',
          querystring.stringify({
            secret: process.env.RECAPTCHA_SECRET,
            response: req.body.token
          })
        );
        if ( response.data.success && response.data.score > 0.7 ) {
          const buf = crypto.randomBytes(16);
          const newRequest = {
            email: req.body.email,
            token: buf.toString( 'hex'),
            createdAt: Timestamp.now()
          };
          const docRef = await collection.add( newRequest );
          const docSnap = await docRef.get();
          const doc = docSnap.data();
          console.log( 'new request successfully created' );
          console.log( doc );
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
            subject: "Configure Your MySQL Account", // Subject line
            text: "Follow this link to configure your MySQL account: http://localhost:8082/verify-mysql-account/" + newRequest.token, // plain text body
//            html: '<p>Follow this link to configure your MySQL account: <a href="http://localhost:8082/verify-mysql-account/' + newRequest.token + '">Confirmation Link</a>' // HTML version
          });
          console.log("Message sent: %s", info.messageId);
          console.log( info );

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

  } else {
    console.log( 'unsupported request');
    console.log( 'method: ' + req.method );
    console.log( 'path: ' + req.path );
    res.status(500).json({
      message: 'unsupported request'
    });

  }
};
