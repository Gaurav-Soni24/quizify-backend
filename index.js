const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const { GoogleGenerativeAI } = require("@google/generative-ai");
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
app.use(express.json({ limit: "10mb" }));
app.use(cors());

// Environment Variables
const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret_key";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com"; 
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// ==========================================
// GEMINI API KEY ROTATION (7 Keys)
// ==========================================
const GEMINI_API_KEYS = [
  process.env.GEMINI_KEY_1,
  process.env.GEMINI_KEY_2,
  process.env.GEMINI_KEY_3,
  process.env.GEMINI_KEY_4,
  process.env.GEMINI_KEY_5,
  process.env.GEMINI_KEY_6,
  process.env.GEMINI_KEY_7
].filter(Boolean);

let currentGeminiKeyIndex = 0;

function getGeminiModel(modelType = "gemini-2.5-flash") {
  if (GEMINI_API_KEYS.length === 0) {
    throw new Error("No Gemini API keys configured.");
  }
  const key = GEMINI_API_KEYS[currentGeminiKeyIndex];
  // Rotate key for next use
  currentGeminiKeyIndex = (currentGeminiKeyIndex + 1) % GEMINI_API_KEYS.length;
  
  const genAI = new GoogleGenerativeAI(key);
  return genAI.getGenerativeModel({ model: modelType });
}

// ==========================================
// INITIALIZE FIREBASE SAFELY
// ==========================================
try {
  initializeFirebase();
} catch (error) {
  console.error("Failed to initialize Firebase. Please check Vercel Environment Variables.");
}

// Test Route
app.get("/", (req, res) => {
  res.send("Quizify Secure Server is running smoothly");
});

// ==========================================
// TEACHER AUTHENTICATION (JWT)
// ==========================================
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
      { expiresIn: "8h" }
    );
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
// RESTORED: TEACHER DASHBOARD & QUIZ MANAGEMENT
// ==========================================
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

    let allSubmissions = [];
    for (const quiz of userQuizzes) {
      const submissionsSnapshot = await db.collection('quizzes').doc(quiz.id).collection('submissions').get();
      submissionsSnapshot.forEach(doc => {
        allSubmissions.push({
          quizId: quiz.id,
          quizTitle: quiz.title,
          submissionId: doc.id,
          ...doc.data()
        });
      });
    }

    res.status(200).json({
      message: "Welcome to the dashboard",
      user: safeUserData,
      quizzes: userQuizzes,
      submissions: allSubmissions
    });
  } catch (error) {
    console.error("Error accessing dashboard:", error);
    res.status(500).json({ error: "Failed to access dashboard" });
  }
});

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

app.post("/toggle-quiz-public", authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { quizId } = req.body;
  if (!quizId) return res.status(400).json({ error: "Quiz ID is required" });

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

// ==========================================
// AI GENERATION & CREATE QUIZ
// ==========================================
app.post("/generate-questions", authenticateToken, async (req, res) => {
  const { topic, description, field, difficulty } = req.body;

  if (!topic || !difficulty) {
    return res.status(400).json({ error: "Topic and difficulty are required." });
  }

  try {
    // Explicitly using gemini-2.5-flash for reliability and free tier availability
    const model = getGeminiModel("gemini-2.5-flash");
    const prompt = `
      You are an expert educator. Generate a quiz based on the following:
      Topic: ${topic}
      Description/Context: ${description || "General knowledge"}
      Field of Study: ${field || "General"}
      Difficulty: ${difficulty}

      Generate 10 to 15 questions. Include a mix of 'single' (multiple choice with one correct answer), 'multiple' (multiple choice with multiple correct answers), 'integer', and 'text' (short answer) questions.

      Also, recommend a timeLimit (in minutes) and antiCheat settings based on the difficulty.
      
      Respond strictly in the following JSON format without Markdown blocks or extra text:
      {
        "recommendedTimeLimit": 30,
        "recommendedAntiCheat": {
          "copyPaste": true,
          "tabSwitch": true,
          "aiCamera": true
        },
        "questions": [
          {
            "type": "single",
            "text": "Question text here?",
            "marks": 2,
            "options": [
              { "text": "Option 1", "isCorrect": true },
              { "text": "Option 2", "isCorrect": false }
            ]
          },
          {
            "type": "text",
            "text": "Explain the concept of...",
            "marks": 5,
            "correctAnswer": "A brief explanation indicating..."
          }
        ]
      }
    `;

    const result = await model.generateContent(prompt);
    let aiResponse = result.response.text().trim();
    
    if (aiResponse.startsWith("```json")) {
      aiResponse = aiResponse.replace(/^```json/, "").replace(/```$/, "").trim();
    }

    const generatedData = JSON.parse(aiResponse);
    res.status(200).json(generatedData);
  } catch (error) {
    console.error("AI Generation Error:", error);
    res.status(500).json({ error: "Failed to generate questions with AI.", details: error.message });
  }
});

app.post("/create-quiz", authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const quizData = req.body;

  try {
    if (!quizData.title || !Array.isArray(quizData.questions)) {
      return res.status(400).json({ error: "Invalid quiz data structure" });
    }

    const quizId = `quiz_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const antiCheatSettings = quizData.antiCheatSettings || {
      copyPaste: true,
      tabSwitch: true,
      aiCamera: true
    };

    const quizDocument = {
      userId,
      quizId,
      ...quizData,
      antiCheatSettings,
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

// ==========================================
// STUDENT ATTEMPT, SUBMISSION & ANALYTICS
// ==========================================
app.get("/public-quiz/:quizId", async (req, res) => {
  const { quizId } = req.params;
  if (!quizId) return res.status(400).json({ error: "Quiz ID is required" });

  try {
    const db = getFirebaseApp().firestore();
    const quizTitleDoc = await db.collection('quizTitles').doc(quizId).get();

    if (!quizTitleDoc.exists) return res.status(404).json({ error: "Quiz not found" });
    const quizTitleData = quizTitleDoc.data();
    if (!quizTitleData.isPublic) return res.status(403).json({ error: "This quiz is not public" });

    const fullQuizDoc = await db.collection('users').doc(quizTitleData.userId).collection('quizzes').doc(quizId).get();
    if (!fullQuizDoc.exists) return res.status(500).json({ error: "Quiz data is corrupted" });

    const { userId, ...safeQuizData } = fullQuizDoc.data();
    res.status(200).json({ message: "Quiz retrieved successfully", quiz: safeQuizData });
  } catch (error) {
    res.status(500).json({ error: "Failed to retrieve quiz", details: error.message });
  }
});

app.post("/verify-google-attempt", async (req, res) => {
  const { quizId, credential } = req.body;
  if (!quizId || !credential) return res.status(400).json({ error: "Missing parameters" });

  try {
    const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: GOOGLE_CLIENT_ID, 
    });
    const payload = ticket.getPayload();
    const email = payload.email;

    const db = getFirebaseApp().firestore();
    
    const submissionRef = db.collection('quizzes').doc(quizId).collection('submissions').doc(email);
    const subDoc = await submissionRef.get();
    if (subDoc.exists) {
      return res.status(403).json({ error: "You have already completed and submitted this quiz." });
    }

    const startedRef = db.collection('quizzes').doc(quizId).collection('startedAttempts').doc(email);
    const startDoc = await startedRef.get();
    if (startDoc.exists) {
      return res.status(403).json({ error: "Quiz session abandoned. You cannot restart a quiz after leaving or reloading the page." });
    }
    
    res.status(200).json({ message: "Google account verified.", email, name: payload.name });
  } catch (error) {
    console.error("Verification error:", error);
    res.status(401).json({ error: "Invalid Google authentication." });
  }
});

app.post("/start-attempt", async (req, res) => {
    const { quizId, email } = req.body;
    if(!quizId || !email) return res.status(400).json({ error: "Missing data" });

    try {
        const db = getFirebaseApp().firestore();
        await db.collection('quizzes').doc(quizId).collection('startedAttempts').doc(email).set({
            startedAt: new Date().toISOString()
        });
        res.status(200).json({ message: "Attempt started and locked." });
    } catch(err) {
        res.status(500).json({ error: "Failed to lock attempt." });
    }
});

app.post("/submission", async (req, res) => {
  const payload = req.body;
  const { quizId, userDetails, submittedAt, score, questions } = payload;

  if (!quizId || !userDetails || !submittedAt || !score || !questions) {
    return res.status(400).json({ error: "Please provide all required fields." });
  }

  const email = userDetails.email;

  try {
    const manualGradeQuestions = questions.filter(q => q.questionType === 'text' || q.questionType === 'code');
    
    if (manualGradeQuestions.length > 0) {
      const model = getGeminiModel("gemini-2.5-flash"); // Changed here as well
      
      const gradingPrompt = `
        You are a strict but fair automated grader. I will provide a list of student answers.
        Evaluate each answer based on the provided correct answer/rubric.
        Assign marks between 0 and the max marks for that question. Partial credit is allowed.
        
        Student Answers to Grade:
        ${JSON.stringify(manualGradeQuestions.map(q => ({
          questionId: q.originalIndex,
          question: q.questionText,
          studentAnswer: q.userAnswer,
          correctAnswerRubric: q.correctAnswer,
          maxMarks: q.marks
        })))}

        Respond strictly in JSON format representing an array of objects:
        [
          { "questionId": 0, "awardedMarks": 2, "isCorrect": true, "feedback": "Good explanation." }
        ]
      `;

      try {
        const result = await model.generateContent(gradingPrompt);
        let aiResponse = result.response.text().trim();
        if (aiResponse.startsWith("```json")) aiResponse = aiResponse.replace(/^```json/, "").replace(/```$/, "").trim();
        
        const gradingResults = JSON.parse(aiResponse);

        gradingResults.forEach(gradedQ => {
            const questionIndex = questions.findIndex(q => q.originalIndex === gradedQ.questionId);
            if(questionIndex !== -1) {
                questions[questionIndex].marksObtained = gradedQ.awardedMarks;
                questions[questionIndex].isCorrect = gradedQ.awardedMarks > 0;
                questions[questionIndex].aiFeedback = gradedQ.feedback;
                score.obtainedMarks += gradedQ.awardedMarks;
            }
        });

        score.percentage = parseFloat(((score.obtainedMarks / score.totalMarks) * 100).toFixed(2));

      } catch (aiError) {
        console.error("AI Grading failed. Defaulting to 0 for manual questions.", aiError);
      }
    }

    const db = getFirebaseApp().firestore();
    const submissionRef = db.collection('quizzes').doc(quizId).collection('submissions').doc(email);

    const submissionData = {
      createdAt: new Date().toISOString(),
      description: payload.quizDescription || "",
      userDetails,
      submittedAt,
      score,
      questions,
      antiCheat: {
        tabSwitches: payload.tabSwitches || 0,
        webcamStrikes: payload.webcamStrikes || 0,
        copyPasteAttempts: payload.copyPasteAttempts || 0,
        identitySwapDetected: payload.identitySwapDetected || false,
        wasAutoSubmitted: payload.wasAutoSubmitted || false,
        isFlagged: payload.isFlagged || false
      }
    };

    await submissionRef.set(submissionData);
    res.status(201).json({ message: "Submission recorded and graded successfully", score });
  } catch (error) {
    console.error("Error recording submission:", error);
    res.status(500).json({ error: "Failed to record submission", details: error.message });
  }
});

// RESTORED: Get User Quiz Submissions Route (Protected for Teachers)
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

// RESTORED: Get Submissions by Student Email (For Student Portal)
app.get("/student-submissions/:email", async (req, res) => {
  const { email } = req.params;
  
  if (!email) return res.status(400).json({ error: "Email is required" });

  try {
    const db = getFirebaseApp().firestore();
    const submissionsSnapshot = await db.collectionGroup('submissions')
                                      .where('userDetails.email', '==', email)
                                      .get();

    if (submissionsSnapshot.empty) {
      return res.status(404).json({ error: "No submissions found for this email" });
    }

    const submissions = submissionsSnapshot.docs.map(doc => {
      const data = doc.data();
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

// ==========================================
// ERROR HANDLING & EXPORT
// ==========================================
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Something went wrong!", details: err.message });
});

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

module.exports = app;