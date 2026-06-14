# Development Notes

This project is still plain JavaScript. Use ESLint and Prettier on files touched by a change, and keep incremental checks passing before review.

- Prefer small nearby modules over growing very large files.
- Use JSDoc for shared JavaScript data shapes until a TypeScript migration is planned separately.
- Avoid router, CSS framework, or large architecture migrations unless they are discussed as separate work.
- After UI changes, smoke-test TV remote navigation and focus behavior on the affected screen.
