require('dotenv').config();
const admin = require('firebase-admin');

let app;
let firestoreDb;

const initializeFirebase = () => {
  if (!app) {
    try {
      const privateKey = process.env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY;
      
      // Safety check to prevent fatal crash if env var is missing in Vercel
      if (!privateKey) {
          console.error("CRITICAL ERROR: FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY is missing or undefined.");
      }

      const serviceAccount = {
        type: process.env.FIREBASE_SERVICE_ACCOUNT_TYPE,
        project_id: process.env.FIREBASE_SERVICE_ACCOUNT_PROJECT_ID,
        private_key_id: process.env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY_ID,
        // Safely format the key only if it exists
        private_key: privateKey ? privateKey.replace(/\\n/g, '\n') : undefined,
        client_email: process.env.FIREBASE_SERVICE_ACCOUNT_CLIENT_EMAIL,
        client_id: process.env.FIREBASE_SERVICE_ACCOUNT_CLIENT_ID,
        auth_uri: process.env.FIREBASE_SERVICE_ACCOUNT_AUTH_URI,
        token_uri: process.env.FIREBASE_SERVICE_ACCOUNT_TOKEN_URI,
        auth_provider_x509_cert_url: process.env.FIREBASE_SERVICE_ACCOUNT_AUTH_PROVIDER_X509_CERT_URL,
        client_x509_cert_url: process.env.FIREBASE_SERVICE_ACCOUNT_CLIENT_X509_CERT_URL,
        universe_domain: process.env.FIREBASE_SERVICE_ACCOUNT_UNIVERSE_DOMAIN
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
        if (!firestoreDb) throw new Error("Firestore is not initialized");
        const docRef = firestoreDb.collection(collectionName).doc(documentId);
        await docRef.set(data);
        console.log(`Data uploaded successfully to ${collectionName}/${documentId}`);
    } catch (error) {
        console.error("Error uploading data:", error);
        throw error;
    }
};

const downloadProcessData = async (collectionName, documentId) => {
    try {
        if (!firestoreDb) throw new Error("Firestore is not initialized");
        const docRef = firestoreDb.collection(collectionName).doc(documentId);
        const doc = await docRef.get();
        if (doc.exists) {
            return doc.data();
        } else {
            console.log(`No such document in ${collectionName}/${documentId}`);
            return null;
        }
    } catch (error) {
        console.error("Error downloading data:", error);
        throw error;
    }
};

const getFirebaseApp = () => app;

module.exports = { initializeFirebase, getFirebaseApp, uploadProcessData, downloadProcessData };