try {
  // All your existing code here
  // index.js
  const express = require("express");
  const bodyParser = require("body-parser");
  const cors = require("cors");
  const admin = require("firebase-admin");
  const bcrypt = require("bcryptjs");
  const jwt = require("jsonwebtoken");
  const {
    initializeFirebase,
    uploadProcessData,
    downloadProcessData,
    getFirebaseApp,
  } = require("./firebase");

  // Initialize Express app
  const app = express();
  const PORT = process.env.PORT || 3000;

  // Middleware
  app.use(express.json()); // Use express.json() instead of bodyParser.json()
  app.use(cors());

  // JWT Secret
  const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret_key"; // Use environment variables in production

  // Initialize Firebase
  const firebaseApp = initializeFirebase();
  if (!firebaseApp) {
    console.error("Failed to initialize Firebase. Exiting...");
    process.exit(1);
  }

  // Test Route
  app.get("/", (req, res) => {
    res.send("Server is running");
  });

  // Register Route
  app.post("/register", async (req, res) => {
    const { name, email, password, role } = req.body;

    // Basic validation
    if (!name || !email || !password || !role) {
      return res
        .status(400)
        .json({ error: "Please provide all required fields." });
    }

    const userId = email.replace(/[@.]/g, "_"); // Create a unique ID from email

    try {
      // Check if the email already exists
      const existingUser = await downloadProcessData("users", userId);
      if (existingUser) {
        return res.status(400).json({ error: "Email already in use" });
      }

      // Hash the password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      const userData = { name, email, password: hashedPassword, role };
      await uploadProcessData("users", userId, userData);
      res.status(201).json({ message: "User registered successfully" });
    } catch (error) {
      console.error("Error registering user:", error);
      res.status(500).json({ error: "Failed to register user" });
    }
  });

  // Login Route
  app.post("/login", async (req, res) => {
    const { email, password } = req.body;

    // Basic validation
    if (!email || !password) {
      return res
        .status(400)
        .json({ error: "Please provide email and password." });
    }

    const userId = email.replace(/[@.]/g, "_"); // Create a unique ID from email

    try {
      const userData = await downloadProcessData("users", userId);
      if (!userData) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      // Compare hashed passwords
      const isMatch = await bcrypt.compare(password, userData.password);
      if (!isMatch) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      // Generate JWT
      const token = jwt.sign(
        { userId: userId, role: userData.role },
        JWT_SECRET,
        { expiresIn: "1h" } // Token expires in 1 hour
      );

      res.status(200).json({ message: "Login successful", token, userId });
    } catch (error) {
      console.error("Error logging in:", error);
      res.status(500).json({ error: "Failed to login" });
    }
  });

  // Middleware to Verify JWT
  const authenticateToken = (req, res, next) => {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1]; // Bearer TOKEN

    if (!token)
      return res
        .status(401)
        .json({ error: "Access denied. No token provided." });

    jwt.verify(token, JWT_SECRET, (err, user) => {
      if (err) return res.status(403).json({ error: "Invalid token." });
      req.user = user;
      next();
    });
  };

  // Protected Route Example
  app.get("/dashboard", authenticateToken, async (req, res) => {
    const userId = req.user.userId;

    try {
      const userData = await downloadProcessData("users", userId);
      if (!userData) {
        return res.status(404).json({ error: "User not found" });
      }

      // Remove sensitive information before sending
      const { password, ...safeUserData } = userData;

      // Get Firestore instance
      const db = getFirebaseApp().firestore();

      // Fetch quizzes created by the user
      const quizzesSnapshot = await db.collection('quizzes')
        .where('userId', '==', userId)
        .get();

      const userQuizzes = quizzesSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      res.status(200).json({
        message: "Welcome to the dashboard",
        user: safeUserData,
        quizzes: userQuizzes
      });
    } catch (error) {
      console.error("Error accessing dashboard:", error);
      res.status(500).json({ error: "Failed to access dashboard" });
    }
  });

  // Get User Data Route (Protected)
  app.get("/user/:userId", authenticateToken, async (req, res) => {
    const { userId } = req.params;

    try {
      const userData = await downloadProcessData("users", userId);
      if (!userData) {
        return res.status(404).json({ error: "User not found" });
      }

      // Remove sensitive information before sending
      const { password, ...safeUserData } = userData;

      // Get Firestore instance
      const db = getFirebaseApp().firestore();

      // Fetch quizzes created by the user
      const quizzesSnapshot = await db.collection('users').doc(userId).collection('quizzes').get();

      const userQuizzes = quizzesSnapshot.docs.map(doc => ({
        id: doc.id,
        title: doc.data().title,
        isPublic: doc.data().isPublic,
        createdAt: doc.data().createdAt
      }));

      res.status(200).json({
        ...safeUserData,
        quizzes: userQuizzes
      });
    } catch (error) {
      console.error("Error fetching user data:", error);
      res.status(500).json({ error: "Failed to fetch user data" });
    }
  });

  // Create Quiz Route (Protected)
  app.post("/create-quiz", authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    const quizData = req.body;

    try {
      // Validate quiz data structure
      if (!quizData.title || !quizData.description || !Array.isArray(quizData.questions) || !quizData.requiredFields) {
        return res.status(400).json({ error: "Invalid quiz data structure" });
      }

      // Generate a unique quiz ID
      const quizId = `quiz_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Create the quiz document
      const quizDocument = {
        userId,
        quizId,
        ...quizData,
        createdAt: new Date().toISOString()
      };

      // Get Firestore instance
      const db = getFirebaseApp().firestore();

      // Use a batch write for atomicity
      const batch = db.batch();

      // Add quiz to user's quizzes subcollection
      const userQuizRef = db.collection('users').doc(userId).collection('quizzes').doc(quizId);
      batch.set(userQuizRef, quizDocument);

      // Add quiz title and required fields to quizTitles collection
      const quizTitleRef = db.collection('quizTitles').doc(quizId);
      batch.set(quizTitleRef, {
        userId,
        title: quizData.title,
        requiredFields: quizData.requiredFields,
        createdAt: new Date().toISOString(),
        isPublic: false // Default to private
      });

      // Commit the batch
      await batch.commit();

      res.status(201).json({ message: "Quiz created successfully", quizId });
    } catch (error) {
      console.error("Error creating quiz:", error);
      res.status(500).json({ error: "Failed to create quiz" });
    }
  });

  // Toggle Quiz Public Status Route (Protected)
  app.post("/toggle-quiz-public", authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    const { quizId } = req.body;
    if (!quizId) {
      return res.status(400).json({ error: "Quiz ID is required" });
    }

    try {
      const db = getFirebaseApp().firestore();
      
      // Use a transaction for atomicity
      const newIsPublic = await db.runTransaction(async (transaction) => {
        const quizRef = db.collection('users').doc(userId).collection('quizzes').doc(quizId);
        const quizTitleRef = db.collection('quizTitles').doc(quizId);

        const quizDoc = await transaction.get(quizRef);
        const quizTitleDoc = await transaction.get(quizTitleRef);

        if (!quizDoc.exists || !quizTitleDoc.exists) {
          throw new Error("Quiz not found");
        }

        const quizData = quizDoc.data();
        const newIsPublic = !quizData.isPublic;

        transaction.update(quizRef, { isPublic: newIsPublic });
        transaction.update(quizTitleRef, { isPublic: newIsPublic });

        return newIsPublic;
      });

      res.status(200).json({ message: "Toggle successful", isPublic: newIsPublic });
    } catch (error) {
      console.error("Error toggling quiz public status:", error);
      res.status(500).json({ error: "Failed to update quiz public status", details: error.message });
    }
  });

  // Get Public Quiz Information Route
  app.get("/public-quiz/:quizId", async (req, res) => {
    const { quizId } = req.params;

    if (!quizId) {
      return res.status(400).json({ error: "Quiz ID is required" });
    }

    try {
      const db = getFirebaseApp().firestore();
      
      if (!db) {
        throw new Error("Firestore database connection failed");
      }
      
      // Fetch the quiz from the quizTitles collection first
      const quizTitleDoc = await db.collection('quizTitles').doc(quizId).get();

      if (!quizTitleDoc.exists) {
        return res.status(404).json({ error: "Quiz not found", details: "No quiz matches the provided ID" });
      }

      const quizTitleData = quizTitleDoc.data();

      if (!quizTitleData.isPublic) {
        return res.status(403).json({ error: "Access denied", details: "This quiz is not public" });
      }

      // Fetch the full quiz data from the user's quizzes subcollection
      const fullQuizDoc = await db.collection('users').doc(quizTitleData.userId).collection('quizzes').doc(quizId).get();

      if (!fullQuizDoc.exists) {
        return res.status(500).json({ error: "Quiz data is corrupted", details: "Full quiz data not found" });
      }

      const fullQuizData = fullQuizDoc.data();

      // Remove sensitive information
      const { userId, ...safeQuizData } = fullQuizData;

      if (Object.keys(safeQuizData).length === 0) {
        return res.status(500).json({ error: "Quiz data is invalid", details: "No shareable data found in the quiz" });
      }

      res.status(200).json({ message: "Quiz information retrieved successfully", quiz: safeQuizData });
    } catch (error) {
      console.error("Error retrieving public quiz information:", error);
      if (error.name === "FirebaseError") {
        res.status(500).json({ error: "Database operation failed", details: error.message });
      } else if (error instanceof TypeError) {
        res.status(500).json({ error: "Data processing error", details: error.message });
      } else {
        res.status(500).json({ error: "Failed to retrieve quiz information", details: error.message });
      }
    }
  });

  app.delete('/api/quizzes/:quizId', authenticateToken, async (req, res) => {
    try {
      const { quizId } = req.params;
      const userId = req.user.userId;
      const db = getFirebaseApp().firestore();
      
      if (!db) {
        throw new Error("Firestore database connection failed");
      }
      
      // Use a transaction to ensure atomicity
      await db.runTransaction(async (transaction) => {
        // Fetch the quiz from the quizTitles collection
        const quizTitleRef = db.collection('quizTitles').doc(quizId);
        const quizTitleDoc = await transaction.get(quizTitleRef);

        if (!quizTitleDoc.exists) {
          throw new Error("Quiz not found");
        }

        const quizTitleData = quizTitleDoc.data();

        // Check if the user is the owner of the quiz
        if (quizTitleData.userId !== userId) {
          throw new Error("Unauthorized: You don't have permission to delete this quiz");
        }

        // Delete the quiz from the quizTitles collection
        transaction.delete(quizTitleRef);

        // Delete the full quiz data from the user's quizzes subcollection
        const userQuizRef = db.collection('users').doc(userId).collection('quizzes').doc(quizId);
        transaction.delete(userQuizRef);
      });

      res.status(200).json({ message: "Quiz deleted successfully" });
    } catch (error) {
      console.error("Error deleting quiz:", error);
      if (error.message === "Quiz not found") {
        res.status(404).json({ error: "Quiz not found" });
      } else if (error.message.startsWith("Unauthorized")) {
        res.status(403).json({ error: error.message });
      } else if (error.name === "FirebaseError") {
        res.status(500).json({ error: "Database operation failed", details: error.message });
      } else {
        res.status(500).json({ error: "Failed to delete quiz", details: error.message });
      }
    }
  });

  // Error handling middleware
  app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: "Something went wrong!", details: err.message });
  });

  // Start Server
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
} catch (error) {
  console.error("Unhandled error:", error);
  process.exit(1);
}