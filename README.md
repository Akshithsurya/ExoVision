# ExoVision
Install node.js

Create a new Vite project:
textnpm create vite@latest exoplanet-finder -- --template react
cd exoplanet-finder

Install dependencies:
textnpm install

Install dependencies:
textnpm install
This will install the base React setup. Then, add the required additional packages:
textnpm install axios lucide-react recharts tailwindcss postcss autoprefixer


Set up Tailwind CSS:

Initialize Tailwind:
textnpx tailwindcss init -p

Update tailwind.config.js to include content paths:
js/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};

Replace the content of src/index.css with:
text@tailwind base;
@tailwind components;
@tailwind utilities;




Replace the default files with the provided source code:

Copy the provided App.css to src/App.css
Copy the provided index.css to src/index.css (if not already updated)
Copy SpectrumViewer.jsx to src/SpectrumViewer.jsx (or appropriate location)
Copy main.jsx to src/main.jsx
Copy App.jsx to src/App.jsx
Ensure any other referenced files (e.g., in ./ai-services/) like ExoplanetClassifier.js and PredictiveAnalytics.js are created based on the app's logic.

Note: The provided App.jsx is truncated in the documentation. Ensure the full component code is implemented, including all imports, states, and render logic.

npm run dev

