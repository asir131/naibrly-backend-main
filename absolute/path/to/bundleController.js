// ... existing code ...
for (const serviceName of servicesArray) {
  const providersWithService = await ServiceProvider.find({
    "servicesProvided.name": serviceName,
    isApproved: true,
    isActive: true,
  });

  let servicePrice = 50; // Default price if no providers found
  let hourlyRate = 25; // Default hourly rate

  if (providersWithService.length > 0) {
    // Calculate average price and hourly rate from providers
    const totalServicePrice = providersWithService.reduce((sum, provider) => {
      const providerService = provider.servicesProvided.find(
        (s) => s.name === serviceName
      );
      return sum + (providerService?.price || provider.baseServicePrice || 50);
    }, 0);

    const totalHourlyRate = providersWithService.reduce((sum, provider) => {
      const providerService = provider.servicesProvided.find(
        (s) => s.name === serviceName
      );
      return sum + (providerService?.hourlyRate || provider.hourlyRate || 25);
    }, 0);

    servicePrice = Math.round(totalServicePrice / providersWithService.length);
    hourlyRate = Math.round(totalHourlyRate / providersWithService.length);
  }

  // Create service object with name, price and hourly rate
  servicesWithPricing.push({
    name: serviceName,
    price: servicePrice,
    hourlyRate: hourlyRate,
  });

  totalPrice += servicePrice;
}

// Calculate final price using admin-set discount
const finalPrice = totalPrice * (1 - bundleDiscount / 100);

// Create bundle without pricePerPerson
const bundle = new Bundle({
  // ... existing fields ...
  services: servicesWithPricing,
  totalPrice,
  bundleDiscount,
  finalPrice,
  // Remove pricePerPerson
  // ... rest of the fields ...
});

// Modify response to show hourly rates instead of pricePerPerson
res.status(201).json({
  success: true,
  message:
    "Bundle created successfully. Providers in your area will be notified.",
  data: {
    bundle,
    matchingProvidersCount: matchingProviders.length,
    availableSpots: maxParticipants - 1,
    pricing: {
      totalPrice,
      bundleDiscount: `${bundleDiscount}%`,
      finalPrice,
      // Remove pricePerPerson
      commission: {
        rate: `${commissionCalculation.commissionRate}%`,
        amount: commissionCalculation.commissionAmount,
      },
      providerAmount: commissionCalculation.providerAmount,
    },
    services: servicesArray,
    sharing: {
      shareLink,
      qrCode: qrCodeDataUrl,
      shareToken,
    },
  },
});
