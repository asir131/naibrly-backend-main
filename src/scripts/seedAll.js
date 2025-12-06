// Seed the database with baseline configuration plus sample records
require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/database");

const { initializeAdmin } = require("../controllers/adminController");
const { initializeDefaultData } = require("../controllers/categoryController");
const { initializeBundleSettings } = require("../controllers/bundleController");
const {
  initializeCommissionSettings,
} = require("../controllers/commissionController");
const { initializeBanks } = require("../controllers/bankController");

const Admin = require("../models/Admin");
const Bank = require("../models/Bank");
const Bundle = require("../models/Bundle");
const Category = require("../models/Category");
const CategoryType = require("../models/CategoryType");
const Conversation = require("../models/Conversation");
const Customer = require("../models/Customer");
const MoneyRequest = require("../models/MoneyRequest");
const OTP = require("../models/OTP");
const PayoutInformation = require("../models/PayoutInformation");
const ProviderServiceFeedback = require("../models/ProviderServiceFeedback");
const QuickChat = require("../models/QuickChat");
const Service = require("../models/Service");
const ServiceProvider = require("../models/ServiceProvider");
const ServiceRequest = require("../models/ServiceRequest");
const Verification = require("../models/Verification");
const WithdrawalRequest = require("../models/WithdrawalRequest");

const placeholderProfile = "https://placehold.co/200x200?text=Profile";
const placeholderLogo = "https://placehold.co/240x240?text=Logo";
const placeholderDoc = "https://placehold.co/600x400?text=Document";

const logStep = (msg) => console.log(`[seed] ${msg}`);

const createCustomer = async () => {
  const email = "customer@example.com";
  let customer = await Customer.findOne({ email });
  if (!customer) {
    customer = new Customer({
      firstName: "Casey",
      lastName: "Customer",
      email,
      password: "Password123!",
      phone: "5551234567",
      profileImage: { url: placeholderProfile, publicId: "seed_customer" },
      address: {
        street: "123 Main St",
        city: "Sampleville",
        state: "CA",
        zipCode: "94016",
        aptSuite: "Unit 1",
      },
    });
    await customer.save();
    logStep("Created sample customer");
  } else {
    logStep("Sample customer already exists");
  }
  return customer;
};

const createProvider = async () => {
  const email = "provider@example.com";
  let provider = await ServiceProvider.findOne({ email });
  if (!provider) {
    provider = new ServiceProvider({
      firstName: "Pat",
      lastName: "Provider",
      email,
      password: "Password123!",
      phone: "5559876543",
      profileImage: { url: placeholderProfile, publicId: "seed_provider_profile" },
      businessLogo: { url: placeholderLogo, publicId: "seed_provider_logo" },
      businessNameRegistered: "Provider Co",
      businessNameDBA: "Provider Co",
      providerRole: "owner",
      businessAddress: {
        street: "456 Market St",
        city: "Sampleville",
        state: "CA",
        zipCode: "94016",
      },
      serviceAreas: [
        { zipCode: "94016", city: "Sampleville", state: "CA", isActive: true },
      ],
      servicesProvided: [
        { name: "Plumbing", hourlyRate: 120 },
        { name: "Electrical", hourlyRate: 110 },
      ],
      description: "General home services provider",
      experience: 5,
      maxBundleCapacity: 5,
      businessServiceDays: { start: "mon", end: "fri" },
      businessHours: { start: "08:00", end: "18:00" },
      hourlyRate: 100,
      servicePricing: { Plumbing: 120, Electrical: 110 },
      isApproved: true,
      isAvailable: true,
      isActive: true,
      isVerified: false,
      rating: 4.5,
      totalReviews: 3,
      totalJobsCompleted: 12,
    });
    await provider.save();
    logStep("Created sample provider");
  } else {
    logStep("Sample provider already exists");
  }
  return provider;
};

const createVerification = async (provider) => {
  const existing = await Verification.findOne({ provider: provider._id });
  if (existing) {
    logStep("Verification already exists");
    return existing;
  }
  const verification = new Verification({
    provider: provider._id,
    einNumber: "12-3456789",
    businessRegisteredCountry: "US",
    insuranceDocument: { url: placeholderDoc, publicId: "seed_insurance" },
    idCardFront: { url: placeholderDoc, publicId: "seed_id_front" },
    idCardBack: { url: placeholderDoc, publicId: "seed_id_back" },
    firstName: provider.firstName,
    lastName: provider.lastName,
    status: "pending",
  });
  await verification.save();
  logStep("Created verification record");
  return verification;
};

const createPayoutInfo = async (provider) => {
  let bank = await Bank.findOne();
  if (!bank) {
    bank = await Bank.create({
      name: "Demo Bank",
      code: "DEMO",
      routingNumber: "110000000",
      country: "US",
      isActive: true,
    });
  }

  let payoutInfo = await PayoutInformation.findOne({ provider: provider._id });
  if (!payoutInfo) {
    payoutInfo = await PayoutInformation.create({
      provider: provider._id,
      accountHolderName: `${provider.firstName} ${provider.lastName}`,
      bankName: bank.name,
      bankCode: bank.code,
      accountNumber: "000123456789",
      routingNumber: bank.routingNumber,
      accountType: "checking",
      lastFourDigits: "6789",
      isVerified: false,
      verificationStatus: "pending",
      isActive: true,
    });
    logStep("Created payout information");
  } else {
    logStep("Payout information already exists");
  }
  await ServiceProvider.findByIdAndUpdate(provider._id, { hasPayoutSetup: true });
  return payoutInfo;
};

const pickCategoryData = async () => {
  const category = await Category.findOne();
  const categoryType = await CategoryType.findOne();
  const service = await Service.findOne();
  return {
    categoryName: category?.name || "Interior",
    categoryTypeName: categoryType?.name || "Home Repairs & Maintenance",
    serviceName: service?.name || "Plumbing",
    serviceId: service?._id || null,
  };
};

const createBundle = async (customer, provider) => {
  const existing = await Bundle.findOne({ title: "Sample Bundle" });
  if (existing) {
    logStep("Sample bundle already exists");
    return existing;
  }

  const { categoryName, categoryTypeName, serviceName } = await pickCategoryData();
  const now = new Date();
  const bundle = await Bundle.create({
    creator: customer._id,
    provider: provider._id,
    title: "Sample Bundle",
    description: "Example bundle seeded for testing",
    category: categoryName,
    categoryTypeName,
    services: [
      { name: serviceName, hourlyRate: 120, estimatedHours: 2 },
      { name: "Electrical", hourlyRate: 110, estimatedHours: 1 },
    ],
    serviceDate: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
    serviceTimeStart: "09:00",
    serviceTimeEnd: "12:00",
    zipCode: "94016",
    address: {
      street: "456 Market St",
      city: "Sampleville",
      state: "CA",
      aptSuite: "Unit 3",
    },
    maxParticipants: 4,
    currentParticipants: 1,
    participants: [
      {
        customer: customer._id,
        address: {
          street: "123 Main St",
          city: "Sampleville",
          state: "CA",
          zipCode: "94016",
          aptSuite: "Unit 1",
        },
        status: "active",
      },
    ],
    bundleDiscount: 10,
    status: "pending",
    pricing: {
      originalPrice: 350,
      discountAmount: 35,
      finalPrice: 315,
      discountPercent: 10,
    },
    finalPrice: 315,
    providerOffers: [],
    expiresAt: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
    shareToken: "seed-share-token",
  });
  logStep("Created sample bundle");
  return bundle;
};

const createServiceRequest = async (customer, provider) => {
  const existing = await ServiceRequest.findOne({ customer: customer._id });
  if (existing) {
    logStep("Sample service request already exists");
    return existing;
  }

  const { serviceName, serviceId } = await pickCategoryData();
  const request = await ServiceRequest.create({
    customer: customer._id,
    customerName: { firstName: customer.firstName, lastName: customer.lastName },
    provider: provider._id,
    serviceType: serviceName,
    service: serviceId,
    requestedServices: [
      { name: serviceName, status: "pending", price: 150, estimatedHours: 2 },
    ],
    locationInfo: {
      customerZipCode: "94016",
      customerAddress: {
        street: "123 Main St",
        city: "Sampleville",
        state: "CA",
        zipCode: "94016",
        aptSuite: "Unit 1",
      },
    },
    problem: "Leaking pipe under the kitchen sink",
    note: "Please call on arrival",
    scheduledDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    status: "accepted",
    price: 150,
    estimatedHours: 2,
    commission: { rate: 5, amount: 7.5, providerAmount: 142.5 },
  });
  logStep("Created sample service request");
  return request;
};

const createMoneyRequest = async (provider, customer, serviceRequest) => {
  const existing = await MoneyRequest.findOne({ provider: provider._id });
  if (existing) {
    logStep("Money request already exists");
    return existing;
  }

  const request = await MoneyRequest.create({
    serviceRequest: serviceRequest._id,
    provider: provider._id,
    customer: customer._id,
    amount: 200,
    tipAmount: 20,
    totalAmount: 220,
    description: "Initial service charge",
    status: "pending",
    commission: { amount: 11, providerAmount: 209 },
    statusHistory: [
      {
        status: "pending",
        timestamp: new Date(),
        note: "Created by seed script",
        changedBy: provider._id,
        changedByRole: "provider",
      },
    ],
    dueDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
  });
  logStep("Created money request");
  return request;
};

const createConversation = async (customer, provider, serviceRequest, bundle) => {
  const existing = await Conversation.findOne({
    $or: [{ requestId: serviceRequest?._id }, { bundleId: bundle?._id }],
  });
  if (existing) {
    logStep("Conversation already exists");
    return existing;
  }

  const conversation = await Conversation.create({
    customerId: customer._id,
    providerId: provider._id,
    requestId: serviceRequest?._id,
    bundleId: bundle?._id,
    messages: [
      {
        senderId: customer._id,
        senderRole: "customer",
        content: "Hi, thanks for taking the job!",
        timestamp: new Date(),
      },
      {
        senderId: provider._id,
        senderRole: "provider",
        content: "Happy to help. See you soon.",
        timestamp: new Date(),
      },
    ],
    lastMessage: "Happy to help. See you soon.",
    lastMessageAt: new Date(),
    isActive: true,
  });
  logStep("Created conversation with sample messages");
  return conversation;
};

const createQuickChat = async (provider) => {
  const existing = await QuickChat.findOne({ content: "Thanks, I am on the way." });
  if (existing) {
    logStep("Quick chat already exists");
    return existing;
  }
  const quickChat = await QuickChat.create({
    content: "Thanks, I am on the way.",
    createdBy: provider._id,
    createdByRole: "provider",
    isActive: true,
  });
  logStep("Created quick chat template");
  return quickChat;
};

const createFeedback = async (provider, customer) => {
  const existing = await ProviderServiceFeedback.findOne({ provider: provider._id });
  if (existing) {
    logStep("Provider feedback already exists");
    return existing;
  }
  const feedback = await ProviderServiceFeedback.create({
    provider: provider._id,
    customer: customer._id,
    serviceName: "Plumbing",
    rating: 5,
    comment: "Great work, arrived on time and fixed the issue quickly.",
  });
  logStep("Created provider service feedback");
  return feedback;
};

const createOTP = async (customer) => {
  const existing = await OTP.findOne({ email: customer.email });
  if (existing) {
    logStep("OTP already exists");
    return existing;
  }
  const otp = await OTP.create({
    email: customer.email,
    otp: "123456",
    purpose: "password_reset",
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    attempts: 0,
    isUsed: false,
  });
  logStep("Created OTP entry");
  return otp;
};

const createWithdrawalRequest = async (provider) => {
  const existing = await WithdrawalRequest.findOne({ provider: provider._id });
  if (existing) {
    logStep("Withdrawal request already exists");
    return existing;
  }
  const request = await WithdrawalRequest.create({
    provider: provider._id,
    amount: 150,
    status: "pending",
    notes: "Seed withdrawal request",
    method: "manual",
  });
  logStep("Created withdrawal request");
  return request;
};

const run = async () => {
  try {
    await connectDB();
    logStep("Connected to database");

    // Baseline initializers
    await initializeAdmin();
    await initializeDefaultData();
    await initializeCommissionSettings();
    await initializeBundleSettings();
    await initializeBanks();

    // Sample data
    const admin = await Admin.findOne();
    const customer = await createCustomer();
    const provider = await createProvider();
    const verification = await createVerification(provider);
    const payoutInfo = await createPayoutInfo(provider);
    const bundle = await createBundle(customer, provider);
    const serviceRequest = await createServiceRequest(customer, provider);
    const moneyRequest = await createMoneyRequest(provider, customer, serviceRequest);
    const conversation = await createConversation(customer, provider, serviceRequest, bundle);
    const quickChat = await createQuickChat(provider);
    const feedback = await createFeedback(provider, customer);
    const otp = await createOTP(customer);
    const withdrawalRequest = await createWithdrawalRequest(provider);

    logStep("Seed complete");
    console.table(
      [
        ["Admin", admin?._id],
        ["Customer", customer?._id],
        ["Provider", provider?._id],
        ["Verification", verification?._id],
        ["PayoutInformation", payoutInfo?._id],
        ["Bundle", bundle?._id],
        ["ServiceRequest", serviceRequest?._id],
        ["MoneyRequest", moneyRequest?._id],
        ["Conversation", conversation?._id],
        ["QuickChat", quickChat?._id],
        ["ProviderServiceFeedback", feedback?._id],
        ["OTP", otp?._id],
        ["WithdrawalRequest", withdrawalRequest?._id],
      ].map(([name, id]) => ({ name, id: id ? id.toString() : null }))
    );
  } catch (error) {
    console.error("[seed] Error:", error);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
    logStep("Database connection closed");
  }
};

run();
