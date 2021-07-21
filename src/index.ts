import type { HttpFunction } from '@google-cloud/functions-framework/build/src/functions';
import { Firestore, Timestamp } from '@google-cloud/firestore';
import querystring from 'querystring';
import axios from 'axios';
import crypto from 'crypto';

const db = new Firestore({
//  projectId: 'cps-146'
  projectId: process.env.GOOGLE_CLOUD_PROJECT
});

const collection = db.collection('requests');
const accounts = db.collection('accounts');

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
      if ( req.body.email.match(/^.+@nic\.bc\.ca|.+@northislandcollege\.ca$/) ) {
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
