require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { Resend } = require("resend");
const multer = require("multer");
const { v2: cloudinary } = require("cloudinary");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const resend = new Resend(process.env.RESEND_API_KEY);

/* ================= CLOUDINARY ================= */

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

/* ================= MULTER ================= */

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024
  }
});

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

/* ================= PASSWORD VERSION ================= */

function getPasswordVersion() {
  return crypto
    .createHash("sha256")
    .update(process.env.ADMIN_PASSWORD + process.env.JWT_SECRET)
    .digest("hex");
}

/* ================= PRODUCT SCHEMA ================= */

const productSchema = new mongoose.Schema(
  {
    name: String,
    slug: String,

    category: String,
    subcategory: String,

    description: String,

    material: String,
    size: String,
    moq: String,

    image: String,

    marketType: {
      type: String,
      enum: ["export", "india"],
      default: "export"
    },

    status: {
      type: String,
      default: "Active"
    }
  },
  {
    timestamps: true
  }
);

const Product = mongoose.model("Product", productSchema);
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

/* ================= CUSTOMISATION SCHEMA ================= */

const customisationSchema = new mongoose.Schema(
  {
    fullName: String,
    country: String,
    email: String,
    businessType: String,
    phone: String,

    dimensions: String,
    materialPreference: String,
    estimatedQuantity: String,
    specificRequirements: String,

    referenceFiles: Array,

    status: {
      type: String,
      default: "New"
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

const Customisation = mongoose.model("Customisation", customisationSchema);

/* ================= CATALOGUE SCHEMA ================= */

const catalogueSchema = new mongoose.Schema(
  {
    categories: Array,
    subcategories: Array,

    fullName: String,
    companyName: String,
    country: String,
    email: String,
    phone: String,
    website: String,
    additionalNotes: String,

    status: {
      type: String,
      default: "New"
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

const Catalogue = mongoose.model("Catalogue", catalogueSchema);

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
          email,
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

/* ================= SAVE CUSTOMISATION REQUEST WITH FILES ================= */

app.post(
  "/api/customisation",
  upload.array("referenceFiles"),
  async (req, res) => {
    try {
      let uploadedFiles = [];

      if (req.files && req.files.length > 0) {
        for (const file of req.files) {
          const base64File =
            `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;

          const result = await cloudinary.uploader.upload(base64File, {
            folder: "assume-exports-customisation",
            resource_type: "auto"
          });

          uploadedFiles.push({
            name: file.originalname,
            url: result.secure_url,
            type: file.mimetype,
            size: file.size
          });
        }
      }

      const customisation = new Customisation({
        fullName: req.body.fullName,
        country: req.body.country,
        email: req.body.email,
        businessType: req.body.businessType,
        phone: req.body.phone,

        dimensions: req.body.dimensions,
        materialPreference: req.body.materialPreference,
        estimatedQuantity: req.body.estimatedQuantity,
        specificRequirements: req.body.specificRequirements,

        referenceFiles: uploadedFiles
      });

      await customisation.save();

      let filesHtml = "No files uploaded";

      if (uploadedFiles.length > 0) {
        filesHtml = uploadedFiles
          .map(
            (file) =>
              `<p>
                <a href="${file.url}" target="_blank">
                  View File - ${file.name}
                </a>
              </p>`
          )
          .join("");
      }

      await resend.emails.send({
        from: "Assume Exports <onboarding@resend.dev>",
        to: "ravindrapuri81@gmail.com",
        subject: "New Customisation Request | Assume Exports",

        html: `
          <div style="font-family:Arial;padding:20px;line-height:1.7">
            <h2>New Customisation Request</h2>

            <p><strong>Name:</strong> ${req.body.fullName || "N/A"}</p>
            <p><strong>Country:</strong> ${req.body.country || "N/A"}</p>
            <p><strong>Email:</strong> ${req.body.email || "N/A"}</p>
            <p><strong>Phone:</strong> ${req.body.phone || "N/A"}</p>
            <p><strong>Business Type:</strong> ${req.body.businessType || "N/A"}</p>

            <hr>

            <p><strong>Dimensions:</strong> ${req.body.dimensions || "N/A"}</p>
            <p><strong>Material:</strong> ${req.body.materialPreference || "N/A"}</p>
            <p><strong>Estimated Quantity:</strong> ${req.body.estimatedQuantity || "N/A"}</p>

            <p><strong>Specific Requirements:</strong></p>
            <div style="background:#f5f5f5;padding:15px;border-radius:8px;margin-bottom:20px">
              ${req.body.specificRequirements || "N/A"}
            </div>

            <h3>Reference Files</h3>
            ${filesHtml}
          </div>
        `
      });

      res.json({
        success: true,
        message: "Customisation Saved Successfully",
        data: customisation
      });

    } catch (error) {
      console.log(error);

      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }
);

/* ================= GET CUSTOMISATION REQUESTS ================= */

app.get("/api/customisation", async (req, res) => {
  try {
    const data = await Customisation.find().sort({ createdAt: -1 });
    res.json(data);

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/* ================= UPDATE CUSTOMISATION STATUS ================= */

app.put("/api/customisation/:id/status", async (req, res) => {
  try {
    const { status } = req.body;

    const item = await Customisation.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );

    res.json({
      success: true,
      message: "Status updated",
      data: item
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/* ================= DELETE CUSTOMISATION ================= */

app.delete("/api/customisation/:id", async (req, res) => {
  try {
    await Customisation.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: "Customisation request deleted"
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/* ================= SAVE CATALOGUE REQUEST ================= */

app.post("/api/catalogue", async (req, res) => {
  try {
    const catalogue = new Catalogue(req.body);

    await catalogue.save();

    let emailSent = false;

    try {
      await resend.emails.send({
        from: "Assume Exports <onboarding@resend.dev>",
        to: "ravindrapuri81@gmail.com",
        subject: "New Catalogue Request | Assume Exports",

        html: `
          <div style="font-family:Arial;padding:20px;line-height:1.7">
            <h2>New Catalogue Request</h2>

            <p><strong>Name:</strong> ${req.body.fullName || "N/A"}</p>
            <p><strong>Company:</strong> ${req.body.companyName || "N/A"}</p>
            <p><strong>Country:</strong> ${req.body.country || "N/A"}</p>
            <p><strong>Email:</strong> ${req.body.email || "N/A"}</p>
            <p><strong>Phone:</strong> ${req.body.phone || "N/A"}</p>
            <p><strong>Website:</strong> ${req.body.website || "N/A"}</p>

            <hr>

            <p><strong>Categories:</strong> ${Array.isArray(req.body.categories)
            ? req.body.categories.join(", ")
            : "N/A"
          }</p>

            <p><strong>Subcategories:</strong> ${Array.isArray(req.body.subcategories)
            ? req.body.subcategories.join(", ")
            : "N/A"
          }</p>

            <p><strong>Additional Notes:</strong></p>
            <div style="background:#f5f5f5;padding:15px;border-radius:8px">
              ${req.body.additionalNotes || "N/A"}
            </div>
          </div>
        `
      });

      emailSent = true;

    } catch (mailError) {
      console.log("Catalogue Email Error:");
      console.log(mailError.message);
    }

    res.json({
      success: true,
      message: emailSent
        ? "Catalogue Saved & Email Sent"
        : "Catalogue Saved, Email Failed",
      emailSent,
      data: catalogue
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/* ================= GET CATALOGUE REQUESTS ================= */

app.get("/api/catalogue", async (req, res) => {
  try {
    const data = await Catalogue.find().sort({ createdAt: -1 });
    res.json(data);

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/* ================= UPDATE CATALOGUE STATUS ================= */

app.put("/api/catalogue/:id/status", async (req, res) => {
  try {
    const { status } = req.body;

    const item = await Catalogue.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );

    res.json({
      success: true,
      message: "Status updated",
      data: item
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/* ================= DELETE CATALOGUE REQUEST ================= */

app.delete("/api/catalogue/:id", async (req, res) => {
  try {
    await Catalogue.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: "Catalogue request deleted"
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});
/* ================= ADD PRODUCT ================= */

app.post(
  "/api/products",
  upload.single("image"),
  async (req, res) => {
    try {
      let imageUrl = "";

      if (req.file) {
        const base64File =
          `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;

        const result = await cloudinary.uploader.upload(base64File, {
          folder: "assume-products",
          resource_type: "image"
        });

        imageUrl = result.secure_url;
      }

      const product = new Product({
        name: req.body.name,
        slug: req.body.slug,

        category: req.body.category,
        subcategory: req.body.subcategory,

        description: req.body.description,

        material: req.body.material,
        size: req.body.size,
        moq: req.body.moq,

        marketType: req.body.marketType,

        image: imageUrl
      });

      await product.save();

      res.json({
        success: true,
        message: "Product added successfully",
        data: product
      });

    } catch (error) {
      console.log(error);

      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }
);

/* ================= GET PRODUCTS ================= */

app.get("/api/products", async (req, res) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 });

    res.json(products);

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/* ================= GET SINGLE PRODUCT ================= */

app.get("/api/products/:id", async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    res.json(product);

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/* ================= UPDATE PRODUCT ================= */

app.put(
  "/api/products/:id",
  upload.single("image"),
  async (req, res) => {
    try {
      let updateData = {
        name: req.body.name,
        slug: req.body.slug,

        category: req.body.category,
        subcategory: req.body.subcategory,

        description: req.body.description,

        material: req.body.material,
        size: req.body.size,
        moq: req.body.moq,

        marketType: req.body.marketType,

        status: req.body.status
      };

      if (req.file) {
        const base64File =
          `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;

        const result = await cloudinary.uploader.upload(base64File, {
          folder: "assume-products",
          resource_type: "image"
        });

        updateData.image = result.secure_url;
      }

      const product = await Product.findByIdAndUpdate(
        req.params.id,
        updateData,
        { new: true }
      );

      res.json({
        success: true,
        message: "Product updated",
        data: product
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }
);

/* ================= DELETE PRODUCT ================= */

app.delete("/api/products/:id", async (req, res) => {
  try {
    await Product.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: "Product deleted"
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