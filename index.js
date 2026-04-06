const express = require("express");
const cors = require("cors");
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
app.use(express.json());
app.use(cors());

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret_key";

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

  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: "Please provide all required fields." });
  }

  const userId = email.replace(/[@.]/g, "_");

  try {
    const existingUser = await downloadProcessData("users", userId);
    if (existingUser) {
      return res.status(400).json({ error: "Email already in use" });
    }

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

  if (!email || !password) {
    return res.status(400).json({ error: "Please provide email and password." });
  }

  const userId = email.replace(/[@.]/g, "_");

  try {
    const userData = await downloadProcessData("users", userId);
    if (!userData) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const isMatch = await bcrypt.compare(password, userData.password);
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = jwt.sign(
      { userId: userId, role: userData.role },
      JWT_SECRET,
      { expiresIn: "1h" }
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
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) return res.status(401).json({ error: "Access denied. No token provided." });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: "Invalid token." });
    req.user = user;
    next();
  });
};

// Dashboard Route (Protected)
app.get("/dashboard", authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const userData = await downloadProcessData("users", userId);
    if (!userData) {
      return res.status(404).json({ error: "User not found" });
    }

    const { password, ...safeUserData } = userData;
    const db = getFirebaseApp().firestore();

    const quizzesSnapshot = await db.collection('users').doc(userId).collection('quizzes').get();
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

    const { password, ...safeUserData } = userData;
    const db = getFirebaseApp().firestore();

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
    if (!quizData.title || !quizData.description || !Array.isArray(quizData.questions) || !quizData.requiredFields) {
      return res.status(400).json({ error: "Invalid quiz data structure" });
    }

    const quizId = `quiz_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const quizDocument = {
      userId,
      quizId,
      ...quizData,
      createdAt: new Date().toISOString()
    };

    const db = getFirebaseApp().firestore();
    const batch = db.batch();

    const userQuizRef = db.collection('users').doc(userId).collection('quizzes').doc(quizId);
    batch.set(userQuizRef, quizDocument);

    const quizTitleRef = db.collection('quizTitles').doc(quizId);
    batch.set(quizTitleRef, {
      userId,
      title: quizData.title,
      requiredFields: quizData.requiredFields,
      createdAt: new Date().toISOString(),
      isPublic: false
    });

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
    const quizTitleDoc = await db.collection('quizTitles').doc(quizId).get();

    if (!quizTitleDoc.exists) {
      return res.status(404).json({ error: "Quiz not found", details: "No quiz matches the provided ID" });
    }

    const quizTitleData = quizTitleDoc.data();

    if (!quizTitleData.isPublic) {
      return res.status(403).json({ error: "Access denied", details: "This quiz is not public" });
    }

    const fullQuizDoc = await db.collection('users').doc(quizTitleData.userId).collection('quizzes').doc(quizId).get();

    if (!fullQuizDoc.exists) {
      return res.status(500).json({ error: "Quiz data is corrupted", details: "Full quiz data not found" });
    }

    const { userId, ...safeQuizData } = fullQuizDoc.data();
    res.status(200).json({ message: "Quiz information retrieved successfully", quiz: safeQuizData });
  } catch (error) {
    console.error("Error retrieving public quiz information:", error);
    res.status(500).json({ error: "Failed to retrieve quiz information", details: error.message });
  }
});

// Delete Quiz
app.delete('/api/quizzes/:quizId', authenticateToken, async (req, res) => {
  try {
    const { quizId } = req.params;
    const userId = req.user.userId;
    const db = getFirebaseApp().firestore();
    
    await db.runTransaction(async (transaction) => {
      const quizTitleRef = db.collection('quizTitles').doc(quizId);
      const quizTitleDoc = await transaction.get(quizTitleRef);

      if (!quizTitleDoc.exists) {
        throw new Error("Quiz not found");
      }

      if (quizTitleDoc.data().userId !== userId) {
        throw new Error("Unauthorized: You don't have permission to delete this quiz");
      }

      transaction.delete(quizTitleRef);
      const userQuizRef = db.collection('users').doc(userId).collection('quizzes').doc(quizId);
      transaction.delete(userQuizRef);
    });

    res.status(200).json({ message: "Quiz deleted successfully" });
  } catch (error) {
    console.error("Error deleting quiz:", error);
    if (error.message === "Quiz not found") return res.status(404).json({ error: "Quiz not found" });
    if (error.message.startsWith("Unauthorized")) return res.status(403).json({ error: error.message });
    res.status(500).json({ error: "Failed to delete quiz", details: error.message });
  }
});

// NEW: Verify Attempt (Checks if email already submitted this quiz)
app.post("/verify-attempt", async (req, res) => {
  const { quizId, email } = req.body;
  if (!quizId || !email) return res.status(400).json({ error: "Quiz ID and Email are required" });

  try {
    const db = getFirebaseApp().firestore();
    const submissionRef = db.collection('quizzes').doc(quizId).collection('submissions').doc(email);
    const doc = await submissionRef.get();

    if (doc.exists) {
      return res.status(403).json({ error: "This email has already submitted an attempt for this quiz." });
    }
    res.status(200).json({ message: "Email verified for attempt." });
  } catch (error) {
    console.error("Error verifying attempt:", error);
    res.status(500).json({ error: "Failed to verify attempt details" });
  }
});

// UPDATED: Submission Route (Includes Anti-Cheat flags)
app.post("/submission", async (req, res) => {
  const { quizId, userDetails, submittedAt, score, questions, tabSwitches, wasAutoSubmitted, isFlagged } = req.body;

  if (!quizId || !userDetails || !submittedAt || !score || !questions) {
    return res.status(400).json({ error: "Please provide all required fields." });
  }

  const email = userDetails.email;

  try {
    const db = getFirebaseApp().firestore();
    const submissionRef = db.collection('quizzes').doc(quizId).collection('submissions').doc(email);

    const submissionData = {
      createdAt: new Date().toISOString(),
      description: req.body.quizDescription || "",
      userDetails,
      submittedAt,
      score,
      questions,
      antiCheat: {
        tabSwitches: tabSwitches || 0,
        wasAutoSubmitted: wasAutoSubmitted || false,
        isFlagged: isFlagged || false
      }
    };

    await submissionRef.set(submissionData);
    res.status(201).json({ message: "Submission recorded successfully" });
  } catch (error) {
    console.error("Error recording submission:", error);
    res.status(500).json({ error: "Failed to record submission", details: error.message });
  }
});

// Get User Quiz Submissions Route (Protected)
app.get("/quiz-submissions/:quizId", authenticateToken, async (req, res) => {
  const { quizId } = req.params;

  try {
    const db = getFirebaseApp().firestore();
    const submissionsSnapshot = await db.collection('quizzes').doc(quizId).collection('submissions').get();

    if (submissionsSnapshot.empty) {
      return res.status(404).json({ error: "No submissions found for this quiz" });
    }

    const submissions = submissionsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.status(200).json({ message: "Submissions retrieved successfully", submissions });
  } catch (error) {
    console.error("Error retrieving quiz submissions:", error);
    res.status(500).json({ error: "Failed to retrieve quiz submissions", details: error.message });
  }
});

// NEW: Get Submissions by Student Email (For the new Student Portal)
app.get("/student-submissions/:email", async (req, res) => {
  const { email } = req.params;
  
  if (!email) return res.status(400).json({ error: "Email is required" });

  try {
    const db = getFirebaseApp().firestore();
    // Use Collection Group query to find submissions across all quizzes matching the email
    const submissionsSnapshot = await db.collectionGroup('submissions')
                                      .where('userDetails.email', '==', email)
                                      .get();

    if (submissionsSnapshot.empty) {
      return res.status(404).json({ error: "No submissions found for this email" });
    }

    const submissions = submissionsSnapshot.docs.map(doc => {
      const data = doc.data();
      // Extract Quiz ID from the reference path (quizzes/{quizId}/submissions/{email})
      const quizId = doc.ref.parent.parent.id; 
      return {
        quizId,
        id: doc.id,
        ...data
      };
    });

    res.status(200).json({ message: "Student records retrieved successfully", submissions });
  } catch (error) {
    console.error("Error retrieving student submissions:", error);
    res.status(500).json({ error: "Failed to retrieve student records", details: error.message });
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