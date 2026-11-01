import { MantineColorsTuple, createTheme } from "@mantine/core";

/** The copper of the app icon. Shade 6 is the light accent, 4 the dark one. */
const copper: MantineColorsTuple = [
  "#fbf3ec",
  "#f3e2d3",
  "#e8c4a6",
  "#dca475",
  "#d68a52",
  "#c8763d",
  "#b5652e",
  "#9e5524",
  "#84461d",
  "#6b3816",
];

const FONT = '"Noto Sans JP Variable", system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Yu Gothic UI", sans-serif';

export const theme = createTheme({
  // The app's root font size is 14px; Mantine sizes assume 16px.
  scale: 16 / 14,
  primaryColor: "copper",
  primaryShade: { light: 6, dark: 4 },
  colors: { copper },
  autoContrast: true,
  fontFamily: FONT,
  headings: { fontFamily: FONT },
  fontFamilyMonospace: 'ui-monospace, "Cascadia Code", Consolas, monospace',
  defaultRadius: "md",
  cursorType: "pointer",
  components: {
    Button: { defaultProps: { variant: "default", fw: 500 } },
    InputWrapper: { defaultProps: { inputWrapperOrder: ["label", "input", "description", "error"] }, styles: { label: { fontWeight: 600, marginBottom: 4 }, description: { marginTop: 4 } } },
    Modal: { defaultProps: { centered: true, radius: "md" } },
    Menu: { defaultProps: { shadow: "md", radius: "md" } },
    Tooltip: { defaultProps: { openDelay: 400, withArrow: true } },
  },
});
