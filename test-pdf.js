const axios = require('axios');

async function test() {
  try {
    const res = await axios.post('https://crm.chaloontour.com/api/leads/convert-to-pdf', {
      leadId: 'test-lead-id',
      data: { quoteNumber: 'TEST-123' },
      fileName: 'test-pdf'
    }, {
      headers: {
        'Authorization': 'Bearer YOUR_TOKEN_HERE' // I need a token if it's protected
      }
    });
    console.log('Success:', res.status);
  } catch (err) {
    console.error('Error:', err.response ? err.response.data : err.message);
  }
}

// test();
