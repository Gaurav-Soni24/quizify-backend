const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

let app;
let firestoreDb;

const initializeFirebase = () => {
  try {
    app = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    firestoreDb = admin.firestore();
    console.log("Firebase initialized successfully");
    return app;
  } catch (error) {
    console.error("Error initializing Firebase:", error);
    return null; // Return null if initialization fails
  }
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
