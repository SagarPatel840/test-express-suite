import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from '../_shared/cors.ts';

const googleAIApiKey = Deno.env.get('GOOGLE_AI_API_KEY');

console.log('=== Google AI Studio Function Starting ===');
console.log('API Key exists:', !!googleAIApiKey);

serve(async (req) => {
  console.log('🚀 Function called with method:', req.method);
  
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    console.log('✅ Handling CORS preflight');
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('📥 Processing POST request');
    
    const requestBody = await req.json();
    console.log('📋 Request received:', Object.keys(requestBody));
    
    const { swaggerSpec } = requestBody;

    if (!swaggerSpec) {
      console.log('❌ No swagger spec provided');
      return new Response(JSON.stringify({ error: 'Swagger specification is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!googleAIApiKey) {
      console.log('❌ No Google AI API key configured');
      return new Response(JSON.stringify({ error: 'Google AI API key not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('✅ Validations passed');
    console.log('🔑 API Key (first 8 chars):', googleAIApiKey.substring(0, 8));

    const prompt = `Based on this Swagger/OpenAPI specification, generate API test cases in CSV format.

Swagger Spec:
${JSON.stringify(swaggerSpec, null, 2)}

Generate test cases in this exact format:
API Endpoint | Method | Test Scenario | Input Data | Expected Result | Positive/Negative

Create at least 15-20 comprehensive test cases covering:
- Positive scenarios (valid requests)
- Negative scenarios (invalid data, missing parameters)
- Edge cases
- Different HTTP methods

Return only the CSV data, no additional text.`;

    const googleAIUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${googleAIApiKey}`;
    console.log('🌐 Google AI URL configured');
    
    console.log('📤 Sending request to Google AI Studio...');
    
    const response = await fetch(googleAIUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.3,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 4096,
        }
      }),
    });

    console.log('📨 Google AI response status:', response.status);
    console.log('📨 Google AI response ok:', response.ok);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Google AI error:', response.status);
      console.error('❌ Error details:', errorText);
      
      return new Response(JSON.stringify({ 
        error: `Google AI API error: ${response.status}`, 
        details: errorText,
        apiKeyPrefix: googleAIApiKey.substring(0, 8)
      }), {
        status: response.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await response.json();
    console.log('✅ Google AI response received');
    console.log('📋 Response keys:', Object.keys(data));

    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
      console.error('❌ Invalid response structure');
      return new Response(JSON.stringify({ 
        error: 'Invalid response from Google AI',
        details: 'Missing candidates in response',
        responseKeys: Object.keys(data)
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const aiResponse = data.candidates[0].content.parts[0].text || 'No content received';
    console.log('✅ AI Response length:', aiResponse.length);
    console.log('📝 AI Response preview:', aiResponse.substring(0, 200));

    // Parse CSV response into array format
    const csvLines = aiResponse.trim().split('\n');
    const csvData = csvLines.map(line => {
      // Simple CSV parsing - split by pipe (|) or comma and handle quoted values
      const fields = [];
      let current = '';
      let inQuotes = false;
      const delimiter = line.includes('|') ? '|' : ',';
      
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"' && (i === 0 || line[i-1] === delimiter)) {
          inQuotes = true;
        } else if (char === '"' && inQuotes && (i === line.length - 1 || line[i+1] === delimiter)) {
          inQuotes = false;
        } else if (char === delimiter && !inQuotes) {
          fields.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      fields.push(current.trim());
      return fields.map(field => field.replace(/^"|"$/g, '')); // Remove surrounding quotes
    });

    const postmanCollection = {
      info: {
        name: 'Generated Test Collection',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
      },
      item: [
        {
          name: 'Create Pet Test',
          request: {
            method: 'POST',
            url: '{{baseUrl}}/pet',
            body: {
              mode: 'raw',
              raw: '{"name":"Buddy","status":"available"}'
            }
          }
        }
      ]
    };

    console.log('✅ Sending successful response');

    return new Response(JSON.stringify({
      success: true,
      csvData: csvData,
      postmanCollection: postmanCollection,
      rawResponse: aiResponse,
      debug: {
        googleAIUrl: googleAIUrl,
        apiKeyPrefix: googleAIApiKey.substring(0, 8),
        responseStatus: response.status
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('💥 Function error:', error.message);
    console.error('💥 Error stack:', error.stack);
    
    return new Response(JSON.stringify({
      error: 'Failed to generate test cases',
      details: error.message,
      stack: error.stack,
      debug: {
        hasApiKey: !!googleAIApiKey,
        apiKeyPrefix: googleAIApiKey?.substring(0, 8)
      }
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});