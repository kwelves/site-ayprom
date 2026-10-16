# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- Public catalog (ayprom-gidravlika.kg): mechanics, fleet owners and buyers looking for hydraulic parts for special machinery and trucks, often on a phone, then writing to WhatsApp.
- Admin (`/admin`): AYPROM staff who maintain the catalog (products, photos, categories, brands, vehicle types, the vehicle showcase), mainly on a laptop/PC; the phone is secondary.

## Product Purpose

AYPROM sells hydraulics and spare parts for special machinery and trucks. The public site is a searchable catalog that leads to a WhatsApp conversation; the admin is the working tool that keeps that catalog correct and publishes it.

## Positioning

A catalog of about 2 000 parts made findable by search, with compatibility by brand and vehicle type, from a company that answers in WhatsApp rather than selling online.

## Operating Context

- Admin edits are saved to Supabase and published to the static Cloudflare site by a background publication worker; the admin shows "published / waiting for publication".
- Photos are processed in the background (photo queue) and appear in the product when ready.
- The admin is one of several AYPROM tools (future AYPROM App, ERP/CRM, analytics, AypromOS); all of them must look like one family.

## Capabilities and Constraints

- No cart, checkout, online payment or prices anywhere.
- Search and backend pagination; the full catalog is never loaded in the browser.
- Colors only through semantic tokens (`src/app/globals.css`, `npm run check:colors`).
- Existing admin functions must keep working exactly (e2e suite `scripts/e2e/run-admin-cloudflare.mjs`).

## Brand Commitments

- AYPROM blue `#084bb9` with the slate grey scale; no CAT yellow.
- Binding design system: AYPROM Design System v2 "Контрастное стекло" (`C:\Erkin\ayprom-design-system\AYPROM-DESIGN-SYSTEM.md`): the public catalog is matte (Rubik, Razer F5), the working tools (admin) are contrast glass with Geist, light scene plus a remembered dark theme.
- Admin name: "AYPROM · Админка".
- Voice: short, like a craftsman talking to a colleague; buttons name the action; no exclamation marks or emoji.

## Evidence on Hand

Real catalog data lives in Supabase; local development uses test fixtures only. No testimonials, prices or stock figures may be invented.

## Product Principles

1. Finding a part fast matters more than browsing.
2. Every admin action shows its result immediately and plainly (saved, processing, waiting for publication, published).
3. One visual family across all AYPROM tools.
4. Keep what works; change the look and the ergonomics, never the function.
