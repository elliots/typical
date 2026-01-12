import { typicalPlugin } from "@elliots/bun-plugin-typical";

void Bun.plugin(
  typicalPlugin({
    typical: {
      validateCasts: true,
      sourceMap: {
        enabled: true,
        includeContent: true,
        inline: true,
      },
    },
  }),
);
