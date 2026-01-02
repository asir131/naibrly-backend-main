const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const Customer = require("../models/Customer");

const getCallbackUrl = () => {
  if (process.env.GOOGLE_CALLBACK_URL) return process.env.GOOGLE_CALLBACK_URL;
  const baseUrl = process.env.SERVER_URL || "http://localhost:5000";
  return `${baseUrl}/api/auth/google/callback`;
};

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: getCallbackUrl(),
    },
    async (_accessToken, _refreshToken, profile, done) => {
      try {
        const email = profile?.emails?.[0]?.value;
        if (!email) {
          return done(null, false, { message: "Google account has no email" });
        }

        let customer = await Customer.findOne({ googleId: profile.id });
        if (!customer) {
          customer = await Customer.findOne({ email: email.toLowerCase() });
        }

        if (!customer) {
          const givenName = profile?.name?.givenName || "";
          const familyName = profile?.name?.familyName || "";
          const randomPassword = Math.random().toString(36).slice(2) + Date.now().toString(36);

          customer = new Customer({
            firstName: givenName || "Google",
            lastName: familyName || "User",
            email: email.toLowerCase(),
            password: randomPassword,
            phone: "",
            address: {
              street: "",
              city: "",
              state: "",
              zipCode: "",
              aptSuite: "",
            },
            googleId: profile.id,
            authProvider: "google",
            profileImage: {
              url: profile?.photos?.[0]?.value || undefined,
            },
          });

          await customer.save();
        } else if (!customer.googleId) {
          customer.googleId = profile.id;
          customer.authProvider = customer.authProvider || "local";
          await customer.save();
        }

        return done(null, customer);
      } catch (error) {
        return done(error);
      }
    }
  )
);

module.exports = passport;
