import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      animation: {
        "ping-slow": "ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite",
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};

export default config;
