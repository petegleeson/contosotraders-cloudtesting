import { Reporter, FullResult } from "@playwright/test/reporter";
import fs from "fs/promises";
import http from "http";
import https from "https";
import { URL } from "url";
import path from "path";

class StatsReporter implements Reporter {
  private endpoint: string;
  private jsonFile: string;

  constructor() {
    // Read endpoint from environment variable or fall back to default
    this.endpoint =
      process.env.STATS_ENDPOINT || "http://localhost:8000/api/run/results";

    // Determine JSON results file location using Playwright's environment variables
    const outputFile = process.env.PLAYWRIGHT_JSON_OUTPUT_FILE;
    const outputDir = process.env.PLAYWRIGHT_JSON_OUTPUT_DIR || process.cwd();
    const outputName =
      process.env.PLAYWRIGHT_JSON_OUTPUT_NAME || "test-results.json";

    this.jsonFile = outputFile || path.join(outputDir, outputName);
  }

  async onEnd(result: FullResult) {
    try {
      // Check if endpoint is configured
      if (!this.endpoint) {
        throw new Error(
          "Stats endpoint not configured - cannot upload results"
        );
      }

      const jsonResults = await fs.readFile(this.jsonFile, "utf-8");
      const testResults = JSON.parse(jsonResults);

      // Send results using Node's http module
      await this.sendResults(testResults);
      console.log("Successfully sent test results to endpoint");
    } catch (error) {
      if ((error as any).code === "ECONNREFUSED") {
        console.warn(
          `Warning: Could not connect to stats server at ${this.endpoint} - Is the server running?`
        );
      } else {
        console.error("Error processing or sending test results:", error);
      }
      throw error;
    }
  }

  private sendResults(payload: any): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.endpoint);
      const data = JSON.stringify(payload);

      const options = {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
          Authorization: `Bearer ${process.env.STAT_REPORTER_AUTH_TOKEN}`,
        },
        // Force IPv4
        family: 4,
      };

      // Choose http or https module based on protocol
      const requestModule = url.protocol === "https:" ? https : http;

      const req = requestModule.request(options, (res) => {
        let responseData = "";

        res.on("data", (chunk) => {
          responseData += chunk;
        });

        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
          } else {
            console.error(
              "Failed to send test results:",
              res.statusCode,
              responseData
            );
            reject(new Error(`HTTP ${res.statusCode}: ${responseData}`));
          }
        });
      });

      req.on("error", (error) => {
        console.error("Error sending request:", error);
        reject(error);
      });

      req.write(data);
      req.end();
    });
  }
}

export default StatsReporter;
