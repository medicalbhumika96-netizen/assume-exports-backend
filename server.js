require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const nodemailer = require("nodemailer");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

/* ================= MONGODB ================= */

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("MongoDB Connected");
  })
  .catch((err) => {
    console.log("MongoDB Connection Error:");
    console.log(err.message);
  });

/* ================= EMAIL ================= */

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,

  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },

  tls: {
    rejectUnauthorized: false
  },

  family: 4
});

/* ================= PASSWORD VERSION ================= */

function getPasswordVersion() {
  return crypto
    .createHash("sha256")
    .update(process.env.ADMIN_PASSWORD + process.env.JWT_SECRET)
    .digest("hex");
}

/* ================= JWT MIDDLEWARE ================= */

const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({
      success: false,
      message: "No token provided"
    });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.passwordVersion !== getPasswordVersion()) {
      return res.status(401).json({
        success: false,
        message: "Password changed. Please login again."
      });
    }

    req.admin = decoded;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token"
    });
  }
};

/* ================= SCHEMA ================= */

const inquirySchema = new mongoose.Schema(
  {
    name: String,
    email: String,
    phone: String,
    companyName: String,
    productName: String,
    quantity: String,
    message: String,
    emailRoute: String,

    status: {
      type: String,
      default: "New"
    },

    priority: {
      type: String,
      default: "Normal"
    },

    date: {
      type: String,
      default: () => new Date().toLocaleString()
    }
  },
  {
    timestamps: true
  }
);

const Inquiry = mongoose.model("Inquiry", inquirySchema);

/* ================= HOME ================= */

app.get("/", (req, res) => {
  res.send("Assume Exports Backend Running");
});

/* ================= ADMIN LOGIN ================= */

app.post("/api/admin/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (
      email === process.env.ADMIN_EMAIL &&
      password === process.env.ADMIN_PASSWORD
    ) {
      const token = jwt.sign(
        {
          email: email,
          role: "admin",
          passwordVersion: getPasswordVersion()
        },
        process.env.JWT_SECRET,
        {
          expiresIn: "1d"
        }
      );

      return res.json({
        success: true,
        message: "Login successful",
        token
      });
    }

    return res.status(401).json({
      success: false,
      message: "Invalid email or password"
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/* ================= SAVE INQUIRY PUBLIC ================= */

app.post("/api/inquiries", async (req, res) => {
  try {
    const inquiry = new Inquiry(req.body);

    await inquiry.save();

    let emailSent = false;

    try {
      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: "ravindrapuri81@gmail.com",
        subject: "New Inquiry Received | Assume Exports",
        html: `
          <div style="font-family:Arial;padding:20px;line-height:1.7">
            <h2 style="color:#111">New Inquiry Received</h2>

            <p><strong>Name:</strong> ${req.body.name || "N/A"}</p>
            <p><strong>Phone:</strong> ${req.body.phone || "N/A"}</p>
            <p><strong>Email:</strong> ${req.body.email || "N/A"}</p>
            <p><strong>Company:</strong> ${req.body.companyName || "N/A"}</p>
            <p><strong>Product:</strong> ${req.body.productName || "N/A"}</p>
            <p><strong>Quantity:</strong> ${req.body.quantity || "N/A"}</p>

            <p><strong>Message:</strong></p>
            <div style="background:#f5f5f5;padding:15px;border-radius:8px">
              ${req.body.message || "N/A"}
            </div>
          </div>
        `
      });

      emailSent = true;
    } catch (mailError) {
      console.log("Email Error:");
      console.log(mailError.message);
    }

    res.json({
      success: true,
      message: emailSent
        ? "Inquiry Saved & Email Sent"
        : "Inquiry Saved, Email Failed",
      emailSent,
      data: inquiry
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/* ================= GET INQUIRIES PROTECTED ================= */

app.get("/api/inquiries", verifyToken, async (req, res) => {
  try {
    const inquiries = await Inquiry.find().sort({ createdAt: -1 });
    res.json(inquiries);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/* ================= UPDATE STATUS PROTECTED ================= */

app.put("/api/inquiries/:id/status", verifyToken, async (req, res) => {
  try {
    const { status } = req.body;

    const inquiry = await Inquiry.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );

    res.json({
      success: true,
      message: "Status updated",
      data: inquiry
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/* ================= DELETE INQUIRY PROTECTED ================= */

app.delete("/api/inquiries/:id", verifyToken, async (req, res) => {
  try {
    await Inquiry.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: "Inquiry deleted"
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/* ================= START SERVER ================= */

app.listen(PORT, () => {
  console.log(`Server Running On Port ${PORT}`);
});