import { httpRouter } from 'convex/server';
import { auth } from './auth';

const http = httpRouter();

// Serves the OIDC discovery + JWKS documents and the sign-in routes.
auth.addHttpRoutes(http);

export default http;