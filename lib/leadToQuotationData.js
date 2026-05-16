function formatDate(value, options = { day: '2-digit', month: '2-digit', year: 'numeric' }) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-IN', options);
}

function buildPaxLabel(lead) {
  if (Array.isArray(lead?.paxBreakup) && lead.paxBreakup.length > 0) {
    return lead.paxBreakup
      .map((item) => [item?.count != null ? item.count : null, item?.type].filter(Boolean).join(' ').trim())
      .filter(Boolean)
      .join(', ');
  }
  if (lead?.paxCount != null && lead?.paxType) return `${lead.paxCount} ${lead.paxType}`.trim();
  if (lead?.paxCount != null) return String(lead.paxCount);
  return '';
}

function buildTourDuration(lead) {
  return [
    lead?.tourNights != null && `${lead.tourNights} Nights`,
    lead?.tourDays != null && `${lead.tourDays} Days`
  ]
    .filter(Boolean)
    .join(' / ');
}

function mapLeadToQuotationData(lead) {
  const images = Array.isArray(lead?.tripImages) ? lead.tripImages.filter(Boolean) : [];
  const destinations =
    Array.isArray(lead?.destinations) && lead.destinations.length > 0
      ? lead.destinations.join(', ')
      : lead?.destination || '';

  return {
    quoteNumber: lead?.leadId || '',
    quoteDate: formatDate(lead?.createdAt, { day: '2-digit', month: 'short', year: 'numeric' }),
    perPersonCost:
      lead?.packageCostPerPerson != null
        ? String(lead.packageCostPerPerson)
        : lead?.total_amount != null
          ? String(lead.total_amount)
          : '',
    totalPax: buildPaxLabel(lead),
    vehicleType: lead?.vehicleType || '',
    hotelCategory: lead?.hotelCategory || '',
    mealPlan: lead?.mealPlan || '',
    tourDuration: buildTourDuration(lead),
    tourDateFrom: formatDate(lead?.tourStartDate || lead?.travel_date),
    tourDateTo: formatDate(lead?.tourEndDate || lead?.travel_date),
    pickupPoint: lead?.pickupPoint || '',
    dropPoint: lead?.dropPoint || '',
    destinations,
    packageName: lead?.packageName || '',
    heroMain: images[0] || '',
    heroSub1: images[1] || '',
    heroSub2: images[2] || '',
    hotels: Array.isArray(lead?.accommodation)
      ? lead.accommodation.map((hotel) => ({
          name: hotel?.hotelName || '',
          nights: hotel?.nights != null ? `${hotel.nights} Night${hotel.nights === 1 ? '' : 's'}` : '',
          roomCategory: hotel?.roomType || '',
          roomSharing: hotel?.sharing || '',
          destination: hotel?.destination || ''
        }))
      : [],
    accommodationNote: '',
    flights: Array.isArray(lead?.flights)
      ? lead.flights.map((flight) => ({
          from: flight?.from || '',
          depDate: '',
          depTime: '',
          to: flight?.to || '',
          arrDate: '',
          arrTime: '',
          airline: flight?.airline || '',
          flightNo: '',
          pnr: flight?.pnr || ''
        }))
      : [],
    flightNote: '',
    inclusions: lead?.inclusions || '',
    exclusions: lead?.exclusions || '',
    paymentPolicy: lead?.payment_policy || '',
    cancellationPolicy: lead?.cancellation_policy || '',
    termsAndConditions: lead?.termsAndConditions || '',
    memorableTrip: lead?.memorableTrip || '',
    itinerary: Array.isArray(lead?.itinerary)
      ? lead.itinerary.map((day, index) => ({
          dayLabel: `Day ${day?.day != null ? day.day : index + 1}`,
          date: formatDate(day?.date, { day: '2-digit', month: 'long', year: 'numeric' }),
          title: day?.route || '',
          description: day?.description || '',
          places: Array.isArray(day?.places) ? day.places.filter(Boolean) : []
        }))
      : [],
    ceoName: 'Mr. Utkarsh Kale (C.E.O.)',
    cell1: '9960625167',
    cell2: '9136549898',
    companyEmail: 'bookings@chaloontour.com',
    companyWebsite: 'www.chaloontour.com'
  };
}

module.exports = { mapLeadToQuotationData };
