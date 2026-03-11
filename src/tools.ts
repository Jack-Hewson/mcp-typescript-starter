/**
 * MCP TypeScript Starter - Tools
 *
 * All tool definitions for the MCP server.
 * Tools are functions that the client can invoke to perform actions.
 *
 * ## Tool Annotations
 *
 * Every tool SHOULD have annotations to help AI assistants understand behavior:
 * - readOnlyHint: Tool only reads data, doesn't modify state
 * - destructiveHint: Tool can permanently delete or modify data
 * - idempotentHint: Repeated calls with same args have same effect
 * - openWorldHint: Tool accesses external systems (web, APIs, etc.)
 *
 * ## Schema Conventions
 *
 * NOTE: TypeScript implementation uses Zod for schema validation. Zod v4 only
 * supports `description` for properties, not `title`. This is a language/library
 * limitation compared to other MCP implementations (Python, Go, etc.) that can
 * provide both title and description in JSON schemas.
 *
 * All tool parameters will have:
 * - ✓ description (via .describe())
 * - ✗ title (not supported in Zod v4)
 *
 * ## Implementation Notes
 *
 * ### Schema Differences from Python Reference
 * - TypeScript SDK automatically adds `$schema` field to inputSchema (SDK behavior)
 * - Property `title` fields not supported (Zod v4 limitation)
 * - `outputSchema` is supported via registerTool() method
 * - Icons can be added via _meta field (not yet implemented)
 *
 * ### Task Support
 * - TypeScript SDK may add `execution.taskSupport: forbidden` to tools (SDK default)
 * - This indicates tools run synchronously and don't support task-based execution
 *
 * @see https://modelcontextprotocol.io/docs/concepts/tools
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

let bonusToolLoaded = false;

/**
 * Register all tools with the server.
 */
export function registerTools(server: McpServer): void {
  registerHelloTool(server);
  registerWeatherTool(server);
  registerFlightTrackerTool(server);
  registerFlightAnalysisTool(server);
  registerAskLlmTool(server);
  registerLongTaskTool(server);
  registerLoadBonusTool(server);
  registerConfirmActionTool(server);
  registerGetFeedbackTool(server);
}

/**
 * Basic greeting tool with annotations.
 */
function registerHelloTool(server: McpServer): void {
  server.registerTool(
    'hello',
    {
      title: 'Say Hello',
      description: 'Say hello to a person',
      inputSchema: {
        name: z.string().describe('Name of the person to greet'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ name }) => ({
      content: [{ type: 'text', text: `Hello, ${name}! Welcome to MCP.` }],
    })
  );
}

/**
 * Weather tool with structured output.
 */
function registerWeatherTool(server: McpServer): void {
  server.registerTool(
    'get_weather',
    {
      title: 'Get Weather',
      description: 'Get the current weather for a city',
      inputSchema: {
        city: z.string().describe('City name to get weather for'),
      },
      outputSchema: {
        location: z.string(),
        temperature: z.number(),
        unit: z.string(),
        conditions: z.string(),
        humidity: z.number(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false, // Results vary due to simulation
        openWorldHint: false, // Simulated, not real external calls
      },
    },
    async ({ city }) => {
      const weather = {
        location: city,
        temperature: Math.round(15 + Math.random() * 20),
        unit: 'celsius',
        conditions: ['sunny', 'cloudy', 'rainy', 'windy'][Math.floor(Math.random() * 4)],
        humidity: Math.round(40 + Math.random() * 40),
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(weather, null, 2) }],
        structuredContent: weather,
      };
    }
  );
}

/**
 * Tool that looks up flight information using a plane tracking API.
 */
function registerFlightTrackerTool(server: McpServer): void {
  server.registerTool(
    'track_flight',
    {
      title: 'Track Flight',
      description:
        'Lookup a flight route by its callsign (e.g., AA100) using the ADSBDB API or simply select "Run tool" for a random flight code).',
      inputSchema: {
        flightnumber: z
          .string()
          .describe(
            'Airline callsign (IATA/ICAO), e.g. SWA6320 (leave blank for a random callsign)'
          ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false, // Flight status may change between calls
        openWorldHint: true, // Makes external HTTP requests
      },
    },
    async ({ flightnumber }) => {
      const baseUrl = process.env.ADSBDB_API_BASE_URL ?? 'https://api.adsbdb.com';
      const callsign =
        flightnumber.trim().toLowerCase() === ''
          ? 'random'
          : encodeURIComponent(flightnumber.trim());
      const url = `${baseUrl}/v0/callsign/${callsign}`;

      // ADSBDB can be queried without an API key but supports one via query or header.
      const params = new URLSearchParams();
      const requestUrl = params.toString() ? `${url}?${params.toString()}` : url;

      try {
        const response = await fetch(requestUrl, {});
        if (!response.ok) {
          const body = await response.text();
          return {
            content: [
              {
                type: 'text',
                text: `Error: ${response.status} ${response.statusText}\n${body}`,
              },
            ],
            isError: true,
          };
        }

        const json = (await response.json()) as any;
        // ADSBDB wraps the result under response.flightroute
        const flight = json?.response?.flightroute ?? json;

        if (!flight || (Array.isArray(flight) && flight.length === 0)) {
          return {
            content: [
              {
                type: 'text',
                text: `No flight data found for ${flightnumber}.`,
              },
            ],
          };
        }

        const airline = flight.airline ?? {};
        const origin = flight.origin ?? {};
        const destination = flight.destination ?? {};

        const formatVal = (value: any, fallback = '-') => {
          if (value === undefined || value === null || value === '') return fallback;
          return String(value);
        };

        const formatAirport = (a: any) => {
          const name = formatVal(a.name, '-');
          const code = [a.icao_code, a.iata_code].filter(Boolean).join(' / ') || '-';
          const location = [a.municipality, a.country_name].filter(Boolean).join(', ') || '-';
          const coords =
            a.latitude != null && a.longitude != null
              ? `${a.latitude.toFixed(6)}, ${a.longitude.toFixed(6)}`
              : '-';
          const elev = a.elevation != null ? `${a.elevation} ft` : '-';
          return `${name} (${code})\n  ${location}\n  Lat/Long: ${coords}\n  Elev: ${elev}`;
        };

        const flightCodes: string[] = [];
        if (flight.callsign_icao) flightCodes.push(flight.callsign_icao);
        if (flight.callsign_iata) flightCodes.push(flight.callsign_iata);

        const flightCodeStr = flightCodes.length > 0 ? ` (${flightCodes.join(' / ')})` : '';

        const humanText = `Flight: ${formatVal(flight.callsign, 'Unknown')}${flightCodeStr}\n` +
          `Airline: ${formatVal(airline.name, 'Unknown')} (${[airline.icao, airline.iata].filter(Boolean).join(' / ') || '-'})` +
          `${airline.country ? ` - ${airline.country} (${formatVal(airline.country_iso, '-')})` : ''}` +
          `${airline.callsign ? `\n  Callsign: ${formatVal(airline.callsign, '-')}` : ''}\n\n` +
          `Origin:\n${formatAirport(origin)}\n\n` +
          `Destination:\n${formatAirport(destination)}`;

        return {
          content: [
            {
              type: 'text',
              text: humanText,
            },
          ],
          structuredContent: flight,
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error fetching flight status: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

/**
 * Tool that invokes LLM sampling.
 */
function registerAskLlmTool(server: McpServer): void {
  server.registerTool(
    'ask_llm',
    {
      title: 'Ask LLM',
      description: 'Ask the connected LLM a question using sampling',
      inputSchema: {
        prompt: z.string().describe('The question or prompt to send to the LLM'),
        maxTokens: z.number().optional().default(100).describe('Maximum tokens in response'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false, // LLM responses vary
        openWorldHint: false, // Uses connected client, not external
      },
    },
    async ({ prompt, maxTokens }) => {
      try {
        const result = await server.server.createMessage({
          messages: [{ role: 'user', content: { type: 'text', text: prompt } }],
          maxTokens: maxTokens ?? 100,
        });

        return {
          content: [
            {
              type: 'text',
              text: `LLM Response: ${result.content.type === 'text' ? result.content.text : '[non-text response]'}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Sampling not supported or failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

/**
 * Long-running task with progress updates.
 */
function registerLongTaskTool(server: McpServer): void {
  server.registerTool(
    'long_task',
    {
      title: 'Long Running Task',
      description: 'Simulate a long-running task with progress updates',
      inputSchema: {
        taskName: z.string().describe('Name for this task'),
        steps: z.number().optional().default(5).describe('Number of steps to simulate'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ taskName, steps }, extra) => {
      const numSteps = steps ?? 5;

      for (let i = 0; i < numSteps; i++) {
        await extra.sendNotification({
          method: 'notifications/progress',
          params: {
            progressToken: 'long_task',
            progress: i / numSteps,
            total: 1.0,
          },
        });
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      return {
        content: [
          {
            type: 'text',
            text: `Task "${taskName}" completed successfully after ${numSteps} steps!`,
          },
        ],
      };
    }
  );
}

/**
 * Tool that dynamically loads another tool at runtime.
 */
function registerLoadBonusTool(server: McpServer): void {
  server.registerTool(
    'load_bonus_tool',
    {
      title: 'Load Bonus Tool',
      description: 'Dynamically register a new bonus tool',
      inputSchema: {},
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true, // Loading twice is safe
        openWorldHint: false,
      },
    },
    async (_args, extra) => {
      if (bonusToolLoaded) {
        return {
          content: [
            { type: 'text', text: "Bonus tool is already loaded! Try calling 'bonus_calculator'." },
          ],
        };
      }

      // Register the bonus calculator with structured configuration and outputSchema
      server.registerTool(
        'bonus_calculator',
        {
          title: 'Bonus Calculator',
          description: 'A calculator that was dynamically loaded',
          inputSchema: {
            a: z.number().describe('First number'),
            b: z.number().describe('Second number'),
            operation: z
              .enum(['add', 'subtract', 'multiply', 'divide'])
              .describe('Mathematical operation'),
          },
          outputSchema: {
            result: z.number(),
            operation: z.string(),
          },
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
        },
        async ({ a, b, operation }) => {
          const ops: Record<string, number> = {
            add: a + b,
            subtract: a - b,
            multiply: a * b,
            divide: b !== 0 ? a / b : NaN,
          };
          const result = ops[operation];
          return {
            content: [{ type: 'text', text: `${a} ${operation} ${b} = ${result}` }],
            structuredContent: { result, operation },
          };
        }
      );

      bonusToolLoaded = true;

      // Notify clients that the tools list has changed
      await extra.sendNotification({
        method: 'notifications/tools/list_changed',
        params: {},
      });

      return {
        content: [
          {
            type: 'text',
            text: "Bonus tool 'bonus_calculator' has been loaded! The tools list has been updated.",
          },
        ],
      };
    }
  );
}

// =============================================================================
// Elicitation Tools - Request user input during tool execution
//
// WHY ELICITATION MATTERS:
// Elicitation allows tools to request additional information from users
// mid-execution, enabling interactive workflows. This is essential for:
//   - Confirming destructive actions before they happen
//   - Gathering missing parameters that weren't provided upfront
//   - Implementing approval workflows for sensitive operations
//   - Collecting feedback or additional context during execution
//
// TWO ELICITATION MODES:
// - Form (schema): Display a structured form with typed fields in the client
// - URL: Open a web page (e.g., OAuth flow, feedback form, documentation)
//
// RESPONSE ACTIONS:
// - "accept": User provided the requested information
// - "decline": User explicitly refused to provide information
// - "cancel": User dismissed the request without responding
// =============================================================================

/**
 * Tool that demonstrates form elicitation - requests user confirmation.
 */
function registerConfirmActionTool(server: McpServer): void {
  server.registerTool(
    'confirm_action',
    {
      title: 'Confirm Action',
      description: 'Request user confirmation before proceeding',
      inputSchema: {
        action: z.string().describe('Description of the action to confirm'),
        destructive: z
          .boolean()
          .optional()
          .default(false)
          .describe('Whether the action is destructive'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false, // User response varies
        openWorldHint: false,
      },
    },
    async ({ action, destructive }) => {
      try {
        // Form elicitation: Display a structured form with typed fields
        // The client renders this as a dialog/form based on the JSON schema
        const warningText = destructive ? ' (WARNING: This action is destructive!)' : '';
        const result = await server.server.elicitInput({
          mode: 'form',
          message: `Please confirm: ${action}${warningText}`,
          requestedSchema: {
            type: 'object',
            properties: {
              confirm: {
                type: 'boolean',
                title: 'Confirm',
                description: 'Confirm the action',
              },
              reason: {
                type: 'string',
                title: 'Reason',
                description: 'Optional reason for your choice',
              },
            },
            required: ['confirm'],
          },
        });

        if (result.action === 'accept') {
          const content = result.content ?? {};
          if (content.confirm) {
            const reason = (content.reason as string) || 'No reason provided';
            return {
              content: [{ type: 'text', text: `Action confirmed: ${action}\nReason: ${reason}` }],
            };
          }
          return {
            content: [{ type: 'text', text: `Action declined by user: ${action}` }],
          };
        } else if (result.action === 'decline') {
          return {
            content: [{ type: 'text', text: `User declined to respond for: ${action}` }],
          };
        } else {
          return {
            content: [{ type: 'text', text: `User cancelled elicitation for: ${action}` }],
          };
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Elicitation not supported or failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

/**
 * Tool that demonstrates URL elicitation - opens feedback form in browser.
 */
function registerGetFeedbackTool(server: McpServer): void {
  server.registerTool(
    'get_feedback',
    {
      title: 'Get Feedback',
      description: 'Request feedback from the user',
      inputSchema: {
        question: z.string().describe('The question to ask the user'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false, // User response varies
        openWorldHint: true, // Opens external URL
      },
    },
    async ({ question }) => {
      const feedbackUrl =
        'https://github.com/SamMorrowDrums/mcp-starters/issues/new?template=workshop-feedback.yml&title=' +
        encodeURIComponent(question);

      try {
        // URL elicitation: Open a web page in the user's browser
        // Useful for OAuth flows, external forms, documentation links, etc.
        const result = await server.server.elicitInput({
          mode: 'url',
          message: `Please answer this question: ${question}`,
          elicitationId: `feedback-${Date.now()}`,
          url: feedbackUrl,
        });

        if (result.action === 'accept') {
          return {
            content: [
              {
                type: 'text',
                text: 'Thank you for providing your answer!',
              },
            ],
          };
        } else if (result.action === 'decline') {
          return {
            content: [
              {
                type: 'text',
                text: `No problem! You can answer the question anytime at: ${feedbackUrl}`,
              },
            ],
          };
        } else {
          return {
            content: [{ type: 'text', text: 'Feedback request cancelled.' }],
          };
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `URL elicitation not supported or failed: ${error instanceof Error ? error.message : 'Unknown error'}\n\nYou can still answer at: ${feedbackUrl}`,
            },
          ],
        };
      }
    }
  );
}
