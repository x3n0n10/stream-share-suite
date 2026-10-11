# Development

Run the backend tests and the frontend dev server:

```sh
cd server && npm install && npm test     # backend and API tests
cd web && npm install && npm run dev     # frontend on :5173, proxying to :3000
```

To run the backend against a local data directory:

```sh
cd server && SUITE_DATA_DIR=../data PORT=3000 npm start
```
