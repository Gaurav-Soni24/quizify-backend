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

const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret_key";

// Initialize Firebase
const firebaseApp = initializeFirebase();
if (!firebaseApp) {
  console.error("Failed to initialize Firebase. Exiting...");
  process.exit(1);
}
const db = getFirebaseApp().firestore();

app.get("/", (req, res) => {
  res.send("Quizify Server is running");
});

// ==========================================
// AUTHENTICATION ROUTES
// ==========================================

app.post("/register", async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: "Please provide all required fields." });
  }

  const userId = email.replace(/[@.]/g, "_");
  try {
    const existingUser = await downloadProcessData("users", userId);
    if (existingUser) return res.status(400).json({ error: "Email already in use" });

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

app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Please provide email and password." });

  const userId = email.replace(/[@.]/g, "_");
  try {
    const userData = await downloadProcessData("users", userId);
    if (!userData) return res.status(401).json({ error: "Invalid email or password" });

    const isMatch = await bcrypt.compare(password, userData.password);
    if (!isMatch) return res.status(401).json({ error: "Invalid email or password" });

    const token = jwt.sign({ userId: userId, role: userData.role }, JWT_SECRET, { expiresIn: "24h" });
    res.status(200).json({ message: "Login successful", token, userId });
  } catch (error) {
    console.error("Error logging in:", error);
    res.status(500).json({ error: "Failed to login" });
  }
});

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

// ==========================================
// TEACHER DASHBOARD ROUTES
// ==========================================

// Dashboard Analytics Route
app.get("/dashboard-analytics", authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  try {
    const userData = await downloadProcessData("users", userId);
    if (!userData) return res.status(404).json({ error: "User not found" });
    const { password, ...safeUserData } = userData;

    // Fetch quizzes to get baseline data
    const quizzesSnapshot = await db.collection('users').doc(userId).collection('quizzes').get();
    const totalQuizzes = quizzesSnapshot.size;
    
    let totalSubmissions = 0;
    let totalPassed = 0;

    // We fetch submission counts for analytics
    for (const doc of quizzesSnapshot.docs) {
      const subSnap = await db.collection('quizzes').doc(doc.id).collection('submissions').get();
      totalSubmissions += subSnap.size;
      
      subSnap.forEach(subDoc => {
        const subData = subDoc.data();
        if (subData.score && subData.score.percentage >= 60) {
          totalPassed++;
        }
      });
    }

    res.status(200).json({
      user: safeUserData,
      analytics: {
        totalQuizzes,
        totalSubmissions,
        averagePassRate: totalSubmissions > 0 ? ((totalPassed / totalSubmissions) * 100).toFixed(1) : 0
      }
    });
  } catch (error) {
    console.error("Error accessing dashboard:", error);
    res.status(500).json({ error: "Failed to access dashboard analytics" });
  }
});

// Get User's Quizzes List
app.get("/my-quizzes", authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  try {
    const quizzesSnapshot = await db.collection('users').doc(userId).collection('quizzes').get();
    const userQuizzes = quizzesSnapshot.docs.map(doc => ({
      id: doc.id,
      title: doc.data().title,
      isPublic: doc.data().isPublic,
      createdAt: doc.data().createdAt
    }));
    res.status(200).json({ quizzes: userQuizzes });
  } catch (error) {
    console.error("Error fetching user quizzes:", error);
    res.status(500).json({ error: "Failed to fetch quizzes" });
  }
});

app.post("/create-quiz", authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const quizData = req.body;

  try {
    const quizId = `quiz_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const quizDocument = {
      userId,
      quizId,
      ...quizData,
      createdAt: new Date().toISOString()
    };

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

app.post("/toggle-quiz-public", authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { quizId } = req.body;
  
  try {
    const newIsPublic = await db.runTransaction(async (transaction) => {
      const quizRef = db.collection('users').doc(userId).collection('quizzes').doc(quizId);
      const quizTitleRef = db.collection('quizTitles').doc(quizId);

      const quizDoc = await transaction.get(quizRef);
      if (!quizDoc.exists) throw new Error("Quiz not found");

      const newIsPublic = !quizDoc.data().isPublic;
      transaction.update(quizRef, { isPublic: newIsPublic });
      transaction.update(quizTitleRef, { isPublic: newIsPublic });
      return newIsPublic;
    });
    res.status(200).json({ message: "Toggle successful", isPublic: newIsPublic });
  } catch (error) {
    console.error("Error toggling status:", error);
    res.status(500).json({ error: "Failed to update quiz status" });
  }
});

app.delete('/api/quizzes/:quizId', authenticateToken, async (req, res) => {
  try {
    const { quizId } = req.params;
    const userId = req.user.userId;
    
    await db.runTransaction(async (transaction) => {
      const quizTitleRef = db.collection('quizTitles').doc(quizId);
      const quizTitleDoc = await transaction.get(quizTitleRef);

      if (!quizTitleDoc.exists) throw new Error("Quiz not found");
      if (quizTitleDoc.data().userId !== userId) throw new Error("Unauthorized");

      transaction.delete(quizTitleRef);
      const userQuizRef = db.collection('users').doc(userId).collection('quizzes').doc(quizId);
      transaction.delete(userQuizRef);
    });

    res.status(200).json({ message: "Quiz deleted successfully" });
  } catch (error) {
    console.error("Error deleting quiz:", error);
    res.status(error.message === "Unauthorized" ? 403 : 500).json({ error: error.message });
  }
});

app.get("/quiz-submissions/:quizId", authenticateToken, async (req, res) => {
  const { quizId } = req.params;
  try {
    const submissionsSnapshot = await db.collection('quizzes').doc(quizId).collection('submissions').get();
    const submissions = submissionsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.status(200).json({ submissions });
  } catch (error) {
    res.status(500).json({ error: "Failed to retrieve quiz submissions" });
  }
});


// ==========================================
// STUDENT & ATTEMPT ROUTES
// ==========================================

app.get("/public-quiz/:quizId", async (req, res) => {
  const { quizId } = req.params;
  try {
    const quizTitleDoc = await db.collection('quizTitles').doc(quizId).get();
    if (!quizTitleDoc.exists) return res.status(404).json({ error: "Quiz not found" });
    
    const quizTitleData = quizTitleDoc.data();
    if (!quizTitleData.isPublic) return res.status(403).json({ error: "This quiz is not public" });

    const fullQuizDoc = await db.collection('users').doc(quizTitleData.userId).collection('quizzes').doc(quizId).get();
    if (!fullQuizDoc.exists) return res.status(500).json({ error: "Full quiz data not found" });

    const { userId, ...safeQuizData } = fullQuizDoc.data();
    res.status(200).json({ quiz: safeQuizData });
  } catch (error) {
    res.status(500).json({ error: "Failed to retrieve quiz" });
  }
});

// Anti-Cheat / Eligibility verification route
app.post("/check-eligibility", async (req, res) => {
  const { quizId, email } = req.body;
  if (!quizId || !email) return res.status(400).json({ error: "Quiz ID and Email are required." });

  try {
    const submissionRef = db.collection('quizzes').doc(quizId).collection('submissions').doc(email);
    const doc = await submissionRef.get();
    
    if (doc.exists) {
      return res.status(403).json({ 
        error: "Attempt exists", 
        message: "You have already submitted this quiz." 
      });
    }
    
    res.status(200).json({ message: "Eligible to take the quiz." });
  } catch (error) {
    res.status(500).json({ error: "Error checking eligibility" });
  }
});

app.post("/submission", async (req, res) => {
  const { quizId, userDetails, submittedAt, score, questions, tabSwitches, wasAutoSubmitted } = req.body;
  if (!quizId || !userDetails || !submittedAt || !score) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  const email = userDetails.email;
  try {
    // Check one last time to prevent concurrent submissions
    const submissionRef = db.collection('quizzes').doc(quizId).collection('submissions').doc(email);
    const existing = await submissionRef.get();
    if (existing.exists) {
      return res.status(400).json({ error: "Submission already exists for this email." });
    }

    const isFlagged = tabSwitches > 0;

    const submissionData = {
      createdAt: new Date().toISOString(),
      quizDescription: req.body.quizDescription || "N/A",
      quizTitle: req.body.quizTitle || "N/A",
      userDetails,
      submittedAt,
      score,
      questions,
      antiCheat: {
        tabSwitches: tabSwitches || 0,
        wasAutoSubmitted: wasAutoSubmitted || false,
        isFlagged: isFlagged
      }
    };

    await submissionRef.set(submissionData);
    res.status(201).json({ message: "Submission recorded successfully", isFlagged });
  } catch (error) {
    console.error("Error recording submission:", error);
    res.status(500).json({ error: "Failed to record submission" });
  }
});

// Student portal route to fetch all their submissions across teachers
app.post("/student-submissions", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email is required" });

  try {
    // Requires a collectionGroup index in Firebase on 'submissions'
    const submissionsSnapshot = await db.collectionGroup('submissions')
      .where('userDetails.email', '==', email)
      .get();

    const studentHistory = submissionsSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        quizId: doc.ref.parent.parent.id, // Extracts Quiz ID from the path
        quizTitle: data.quizTitle,
        submittedAt: data.submittedAt,
        score: data.score.percentage,
        isFlagged: data.antiCheat?.isFlagged || false
      }
    });

    res.status(200).json({ history: studentHistory });
  } catch (error) {
    console.error("Error fetching student history:", error);
    res.status(500).json({ error: "Failed to fetch student history. Ensure Firestore indexes are built." });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Something went wrong!", details: err.message });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});