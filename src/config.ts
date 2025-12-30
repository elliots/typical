export interface TypicalConfig {
  include?: string[];
  exclude?: string[];
  reusableValidators?: boolean;
  validateCasts?: boolean;
}

export const defaultConfig: TypicalConfig = {
  include: ["**/*.ts", "**/*.tsx"],
  exclude: ["node_modules/**", "**/*.d.ts", "dist/**", "build/**"],
  reusableValidators: true,
  validateCasts: false,
};

import fs from 'fs';
import path from 'path';

export function loadConfig(configPath?: string): TypicalConfig {
  const configFile = configPath || path.join(process.cwd(), 'typical.json');
  
  if (fs.existsSync(configFile)) {
    try {
      const configContent = fs.readFileSync(configFile, 'utf8');
      const userConfig: Partial<TypicalConfig> = JSON.parse(configContent);
      
      return {
        ...defaultConfig,
        ...userConfig,
      };
    } catch (error) {
      console.warn(`Failed to parse config file ${configFile}:`, error);
      return defaultConfig;
    }
  }

  return defaultConfig;
}