#!/usr/bin/env python3
from pathlib import Path
import re
p = Path("/opt/patwago/api/src/routes/paypal.ts")
t = p.read_text(encoding="utf-8")
# Remove mock success blocks for purchase-pass and booking.
t2 = re.sub(
    r"if \(!order\) \{\s*console\.warn\('\[paypal\] PAYPAL_CLIENT_ID/SECRET not set or token failed[^\n]*\n[\s\S]*?return res\.json\(\{ data: mock, message: 'Mock PayPal order \(PayPal not configured\)\.' \}\);\s*\}",
    "if (!order) {\n      console.warn('[paypal] PAYPAL credentials missing or order create failed.');\n      return apiError(res, 503, 'payments_unavailable', 'PayPal is not configured. Live payments are disabled until credentials are set.');\n    }",
    t,
    count=1,
)
t2 = re.sub(
    r"if \(!order\) \{\s*const mock: BookingPaymentResult = \{[\s\S]*?return res\.json\(\{ data: mock, message: 'Booking created; mock PayPal order \(PayPal not configured\)\.' \}\);\s*\}",
    "if (!order) {\n      return apiError(res, 503, 'payments_unavailable', 'PayPal is not configured. Live payments are disabled until credentials are set.');\n    }",
    t2,
    count=1,
)
# Ensure production never mock-completes capture either
if "CAPTURE-MOCK-" in t2:
    t2 = t2.replace("CAPTURE-MOCK-", "CAPTURE-DISABLED-")
p.write_text(t2, encoding="utf-8")
print("mock markers remaining:", p.read_text().count("PAYPAL-MOCK-"))
print("done")
