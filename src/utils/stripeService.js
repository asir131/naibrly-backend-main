const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

class StripeService {
  constructor() {
    this.stripe = stripe;
  }

  // Create a customer in Stripe
  async createCustomer(email, name, metadata = {}) {
    try {
      const customer = await this.stripe.customers.create({
        email,
        name,
        metadata,
      });
      return customer;
    } catch (error) {
      console.error("Error creating Stripe customer:", error);
      throw new Error(`Failed to create customer: ${error.message}`);
    }
  }

  // Create a payment intent
  async createPaymentIntent(amount, currency, customerId, metadata = {}) {
    try {
      // Convert amount to cents (Stripe uses smallest currency unit)
      const amountInCents = Math.round(amount * 100);

      const paymentIntent = await this.stripe.paymentIntents.create({
        amount: amountInCents,
        currency: currency || "usd",
        customer: customerId,
        automatic_payment_methods: {
          enabled: true,
        },
        metadata,
      });

      return paymentIntent;
    } catch (error) {
      console.error("Error creating payment intent:", error);
      throw new Error(`Failed to create payment intent: ${error.message}`);
    }
  }

  // Confirm payment intent (when customer submits card details)
  async confirmPaymentIntent(paymentIntentId, paymentMethodId) {
    try {
      const paymentIntent = await this.stripe.paymentIntents.confirm(
        paymentIntentId,
        {
          payment_method: paymentMethodId,
          return_url: `${process.env.CLIENT_URL}/payment-success`,
        }
      );

      return paymentIntent;
    } catch (error) {
      console.error("Error confirming payment intent:", error);
      throw new Error(`Payment failed: ${error.message}`);
    }
  }

  // Create payment method (card)
  async createPaymentMethod(cardDetails) {
    try {
      const paymentMethod = await this.stripe.paymentMethods.create({
        type: "card",
        card: {
          number: cardDetails.cardNumber,
          exp_month: parseInt(cardDetails.expMonth),
          exp_year: parseInt(cardDetails.expYear),
          cvc: cardDetails.cvc,
        },
        billing_details: {
          name: cardDetails.name,
          email: cardDetails.email,
        },
      });

      return paymentMethod;
    } catch (error) {
      console.error("Error creating payment method:", error);
      throw new Error(`Invalid card details: ${error.message}`);
    }
  }

  // Retrieve payment intent
  async getPaymentIntent(paymentIntentId) {
    try {
      const paymentIntent = await this.stripe.paymentIntents.retrieve(
        paymentIntentId
      );
      return paymentIntent;
    } catch (error) {
      console.error("Error retrieving payment intent:", error);
      throw new Error(`Failed to retrieve payment: ${error.message}`);
    }
  }
}

module.exports = new StripeService();
