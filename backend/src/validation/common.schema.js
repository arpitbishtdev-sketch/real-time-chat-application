import mongoose from 'mongoose';
import { z } from 'zod';

// A syntactically invalid id must be rejected with 400 before it ever
// reaches a database query — distinct from "well-formed but nonexistent",
// which is a 404 decided at the service layer (TESTING.md #12).
export const objectId = z
  .string()
  .refine((val) => mongoose.Types.ObjectId.isValid(val), { message: 'Must be a valid id.' });
