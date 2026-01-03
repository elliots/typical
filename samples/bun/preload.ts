import { typicalPlugin } from '@elliots/bun-plugin-typical'

void Bun.plugin(
  typicalPlugin({
    typical: {
      reusableValidators: false,
      validateCasts: true,
      sourceMap: {
        enabled: true,
        includeContent: true,
        inline: true,
      },
    },
  }),
)
