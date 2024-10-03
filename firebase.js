require('dotenv').config();

const admin = require('firebase-admin');

const FIREBASE_SERVICE_ACCOUNT_TYPE = process.env.FIREBASE_SERVICE_ACCOUNT_TYPE;
const FIREBASE_SERVICE_ACCOUNT_PROJECT_ID = process.env.FIREBASE_SERVICE_ACCOUNT_PROJECT_ID;
const FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY_ID = process.env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY_ID;
const FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY = process.env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY;
const FIREBASE_SERVICE_ACCOUNT_CLIENT_EMAIL = process.env.FIREBASE_SERVICE_ACCOUNT_CLIENT_EMAIL;
const FIREBASE_SERVICE_ACCOUNT_CLIENT_ID = process.env.FIREBASE_SERVICE_ACCOUNT_CLIENT_ID;
const FIREBASE_SERVICE_ACCOUNT_AUTH_URI = process.env.FIREBASE_SERVICE_ACCOUNT_AUTH_URI;
const FIREBASE_SERVICE_ACCOUNT_TOKEN_URI = process.env.FIREBASE_SERVICE_ACCOUNT_TOKEN_URI;
const FIREBASE_SERVICE_ACCOUNT_AUTH_PROVIDER_X509_CERT_URL = process.env.FIREBASE_SERVICE_ACCOUNT_AUTH_PROVIDER_X509_CERT_URL;
const FIREBASE_SERVICE_ACCOUNT_CLIENT_X509_CERT_URL = process.env.FIREBASE_SERVICE_ACCOUNT_CLIENT_X509_CERT_URL;
const FIREBASE_SERVICE_ACCOUNT_UNIVERSE_DOMAIN = process.env.FIREBASE_SERVICE_ACCOUNT_UNIVERSE_DOMAIN;

let app;
let firestoreDb;

const initializeFirebase = () => {
  if (!app) {
    try {
      const serviceAccount = {
        type: FIREBASE_SERVICE_ACCOUNT_TYPE,
        project_id: FIREBASE_SERVICE_ACCOUNT_PROJECT_ID,
        private_key_id: FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY_ID,
        private_key: FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, '\n'),
        client_email: FIREBASE_SERVICE_ACCOUNT_CLIENT_EMAIL,
        client_id: FIREBASE_SERVICE_ACCOUNT_CLIENT_ID,
        auth_uri: FIREBASE_SERVICE_ACCOUNT_AUTH_URI,
        token_uri: FIREBASE_SERVICE_ACCOUNT_TOKEN_URI,
        auth_provider_x509_cert_url: FIREBASE_SERVICE_ACCOUNT_AUTH_PROVIDER_X509_CERT_URL,
        client_x509_cert_url: FIREBASE_SERVICE_ACCOUNT_CLIENT_X509_CERT_URL,
        universe_domain: FIREBASE_SERVICE_ACCOUNT_UNIVERSE_DOMAIN
      };
      app = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      firestoreDb = admin.firestore();
      console.log("Firebase initialized successfully");
    } catch (error) {
      console.error("Error initializing Firebase:", error);
      throw error;
    }
  }
  return app;
};

const uploadProcessData = async (collectionName, documentId, data) => {
    try {
        if (!firestoreDb) {
            throw new Error("Firestore is not initialized");
        }
        const docRef = firestoreDb.collection(collectionName).doc(documentId);
        await docRef.set(data);
        console.log(`Data uploaded successfully to ${collectionName}/${documentId}`);
    } catch (error) {
        console.error("Error uploading data:", error);
        throw error; // Propagate the error
    }
};

const downloadProcessData = async (collectionName, documentId) => {
    try {
        if (!firestoreDb) {
            throw new Error("Firestore is not initialized");
        }
        const docRef = firestoreDb.collection(collectionName).doc(documentId);
        const doc = await docRef.get();
        if (doc.exists) {
            console.log(`Data downloaded successfully from ${collectionName}/${documentId}`);
            return doc.data();
        } else {
            console.log(`No such document in ${collectionName}/${documentId}`);
            return null;
        }
    } catch (error) {
        console.error("Error downloading data:", error);
        throw error; // Propagate the error
    }
};

const getFirebaseApp = () => app;

module.exports = { initializeFirebase, getFirebaseApp, uploadProcessData, downloadProcessData };