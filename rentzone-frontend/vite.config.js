import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Proxy requests starting with /production to the real API Gateway during dev
      // Replace the target below with your API Gateway domain if it changes.
      '/production': {
        target: 'https://z99qed07b8.execute-api.ap-southeast-2.amazonaws.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path, // keep /production prefix
      },
    },
  },
})
