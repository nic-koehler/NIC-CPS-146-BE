good_to_go=true
[[ -z "${GOOGLE_CLOUD_PROJECT}" ]] && good_to_go=false && echo GOOGLE_CLOUD_PROJECT undefined
[[ -z "${RECAPTCHA_SECRET}" ]] && good_to_go=false && echo RECAPTCHA_SECRET undefined
[[ -z "${DB_HOST}" ]] && good_to_go=false && echo DB_HOST undefined
[[ -z "${DB_USER}" ]] && good_to_go=false && echo DB_USER undefined
[[ -z "${DB_PASS}" ]] && good_to_go=false && echo DB_PASS undefined
[[ -z "${DB_NAME}" ]] && good_to_go=false && echo DB_NAME undefined
[[ -z "${CLOUD_SQL_CONNECTION_NAME}" ]] && good_to_go=false && echo CLOUD_SQL_CONNECTION_NAME undefined
[[ -z "${SMTP_USER}" ]] && good_to_go=false && echo SMTP_USER undefined
[[ -z "${SMTP_PASS}" ]] && good_to_go=false && echo SMTP_PASS undefined
[[ -z "${FRONTEND_URL}" ]] && good_to_go=false && echo FRONTEND_URL undefined
[[ -z "${SYNAPSE_REGISTRATION_URL}" ]] && good_to_go=false && echo SYNAPSE_REGISTRATION_URL undefined
[[ -z "${SYNAPSE_REGISTRATION_SHARED_SECRET}" ]] && good_to_go=false && echo SYNAPSE_REGISTRATION_SHARED_SECRET undefined
if $good_to_go ; then
  gcloud functions deploy nicMySQL --region northamerica-northeast1 --allow-unauthenticated \
    --trigger-http \
    --runtime nodejs12 \
    --set-env-vars \
    GOOGLE_CLOUD_PROJECT=$GOOGLE_CLOUD_PROJECT,\
RECAPTCHA_SECRET=$RECAPTCHA_SECRET,\
DB_HOST=$DB_HOST,\
DB_USER=$DB_USER,\
DB_PASS=$DB_PASS,\
DB_NAME=$DB_NAME,\
CLOUD_SQL_CONNECTION_NAME=$CLOUD_SQL_CONNECTION_NAME,\
SMTP_USER=$SMTP_USER,\
SMTP_PASS=$SMTP_PASS,\
FRONTEND_URL=$FRONTEND_URL,\
SYNAPSE_REGISTRATION_URL=$SYNAPSE_REGISTRATION_URL,\
SYNAPSE_REGISTRATION_SHARED_SECRET=$SYNAPSE_REGISTRATION_SHARED_SECRET
fi
