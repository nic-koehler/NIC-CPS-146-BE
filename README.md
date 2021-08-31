# NIC-CPS-146-BE

## Environment Variables

`DB_SOCKET_PATH` is the directory path used by `cloud_sql_proxy`. This
variable is optional and if it is not present, it defaults to `/cloudsql`.

`DB_USER` is the MySQL user name.

`DB_PASS` is the MySQL password.

`DB_NAME` is the MySQL database name.

`CLOUD_SQL_CONNECTION_NAME` is the Google Cloud SQL connection name.

`GOOGLE_CLOUD_PROJECT` needs to have the ID of the Google Cloud project
that has the Firstore database.

`RECAPTCHA_SECRET` needs to have the reCAPTCHA secret in order to validate
certain requests from the frontend.

`SMTP_USER` is the AWS SES SMTP user name.

`SMTP_PASS` is the AWS SES SMTP password.

`FRONTEND_URL` is the protocol and domain for the frontend website.

`SYNAPSE_REGISTRATION_URL` is the Synapse registration URL.

`SYNAPSE_REGISTRATION_SHARED_SECRET` is the Synapse registration shared secret.

## Deploying to Google Cloud Functions

see `deploy.sh`
