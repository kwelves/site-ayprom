# Claude Instructions

You are building a production-ready website catalog with admin panel.

Always follow `PROJECT_BRIEF.md`.

Important rules:

- Не запускай превью без разрешения или пока я прямо об этом не попрошу
- Не запускай Claude Browser без разрешения или пока я прямо об этом не попрошу
- Do not make the homepage long.
- Keep the homepage compact and focused on catalog navigation.
- Use blue and white as the main color palette.
- Use minimalistic, clean, industrial-style UI.
- Do not implement ecommerce checkout, cart, or online payment.
- Do not implement WhatsApp button in the first version.
- Do not implement AI search in the first version.
- Do not connect a database until the frontend structure is approved.
- Use mock data first.
- Use TypeScript.
- Use Next.js App Router.
- Use Tailwind CSS.
- Use reusable components.
- Keep components small and readable.
- Make the site responsive for mobile, tablet, and desktop.
- Optimize for future catalog size of 5,000 products.
- Never load all products on the frontend in future implementation.
- Catalog pages should be designed with backend pagination and search in mind (no separate filter feature — search is the only way to narrow down products).
- No price field anywhere in the catalog (not an ecommerce store).

When creating code:
- Explain shortly what you changed.
- Do not overcomplicate the architecture.
- Prefer simple, clean, maintainable solutions.
- Ask before adding large dependencies.