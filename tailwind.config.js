/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        "./index.html",
        "./app.js",
        "./public/index.html",
        "./public/**/*.html",
        "./public/**/*.js"
    ],
    darkMode: 'class',
    theme: {
        extend: {
            colors: {
                espresso: {
                    600: '#2e2e2e',
                    700: '#1f1f1f',
                    800: '#141414',
                    900: '#0a0a0a',
                    950: '#000000'
                },
                royal: {
                    // HD palette — matches current live appearance (was previously served by CDN)
                    gold: '#FFD700',
                    pink: '#FF007F',
                    pinkDark: '#4a0020',
                    // Retained for backwards compatibility (no current usage in index.html or app.js)
                    goldDark: '#d9a426',
                    crimson: '#c91429',
                    wheelGold: '#f0c330',
                    teal: '#1b6b6b',
                    purple: '#623aa2',
                    orange: '#ea691c',
                    blue: '#1565c0',
                    green: '#278a3f'
                }
            },
            fontFamily: {
                sans: ['Inter', 'sans-serif'],
                display: ['Outfit', 'sans-serif'],
                mono: ['JetBrains Mono', 'monospace']
            }
        }
    },
    plugins: []
};