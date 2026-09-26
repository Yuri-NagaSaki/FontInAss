import type zh from "./community-zh";

export default {
  workshop: "Subtitle Workshop",
  brand: "AniBT Subtitle Workshop",
  community: "AniBT Community",
  services: "Community services",
  currentService: "You are here",
  serviceAnime: "Anime & releases",
  serviceAnimeDesc:
    "Discover anime, follow subtitle groups and find new releases.",
  serviceSubtitlesDesc:
    "Prepare subtitles, contribute fonts and share your work.",
  serviceWiki: "Community docs",
  serviceWikiDesc: "Read guides for publishing, services and the API.",
  serviceTracker: "Tracker",
  serviceTrackerDesc: "Check Tracker status and connection details.",
  backCommunity: "Back to AniBT",
  skipContent: "Skip to content",
  primaryNav: "Workshop navigation",
  more: "More",
  close: "Close",
  access: "Group access",
  accessSaved: "Font workspace",
  footer: "Discover, create and share with the AniBT community.",
  source: "Workshop source",
  guide: "Guide",
  contact: "Join the community",
  overviewLabel: "Part of the AniBT community",
  heroTitle: "Subtitles, just as you intended.",
  heroDesc:
    "A shared workspace for subtitle makers and anime fans. Match fonts, embed only the glyphs you need and share the finished work.",
  start: "Process subtitles",
  browse: "Browse subtitles",
  formatHint: "ASS, SSA & SRT · No credential required",
  workflowTitle: "From a subtitle file to the full viewing experience",
  stepUpload: "Choose subtitles",
  stepUploadDesc: "Drop in your files and adjust processing options.",
  stepMatch: "Match & subset",
  stepMatchDesc: "Find shared fonts and keep only the glyphs used.",
  stepDownload: "Check & download",
  stepDownloadDesc: "Review warnings and download embedded subtitles.",
  contributeTitle: "Help the next subtitle find its fonts.",
  contributeDesc:
    "Built together by the community. Add a font, share subtitles or tell us what needs improving.",
  contributeFont: "Contribute fonts",
  contributeFontDesc: "Add fonts you have permission to share.",
  contributeArchive: "Share subtitles",
  contributeArchiveDesc: "Submit your work for review and publication.",
  contributeDiscuss: "Discussion & feedback",
  contributeDiscussDesc:
    "Exchange tips and report missing fonts or processing issues.",
  ecosystemTitle: "Your next step, in the same community",
  ecosystemDesc: "Services for discovering, making and sharing anime releases.",
  groupTitle: "A workspace for subtitle groups.",
  groupDesc:
    "Apply for a credential to browse, download and upload fonts, or connect your workflow through the CLI and API.",
  groupAction: "Request group access",
  cliAction: "Command-line guide",
  subsetDesc:
    "Upload subtitles to match and embed the required glyphs. Check warnings and playback before publishing.",
  subsetHelp: "Missing a font?",
  subsetHelpDesc:
    "Check the font names in the result, contribute the missing fonts and try again.",
  subsetSettingsHint:
    "Strict mode, font aliases and font extraction are available in Processing settings above.",
  contributionNote:
    "Only submit files you have permission to share, and retain author and subtitle-group credits.",
  discussionNote:
    "Include steps to reproduce, subtitle format and error messages. Never post credentials or private information.",
  guideTitle: "Create and share in the workshop",
  guideIntro:
    "The Subtitle Workshop is AniBT’s community service for subtitles and fonts, powered by FontInAss. Start here to process subtitles, contribute fonts or share your work.",
  guideOnPage: "On this page",
  guideStart: "Process your first subtitle",
  guideStartIntro:
    "Public subtitle processing needs no group credential. Keep your original files, then follow these steps.",
  guideStep1:
    "Open Process subtitles and choose or drop ASS, SSA or SRT files. SRT is converted to ASS for processing.",
  guideStep2:
    "Adjust Processing settings if needed. Strict mode stops output when a font is missing; aliases help with multi-track muxing.",
  guideStep3:
    "Wait for matching, subsetting and embedding. Each result reports success, warnings or failure.",
  guideStep4:
    "Expand warnings to check missing fonts or glyphs. Download the result and verify it in your target player.",
  guideFonts: "Build the shared font library",
  guideFontsBody:
    "Contribute fonts accepts TTF, OTF, TTC and OTC without a credential. Files are validated and deduplicated. The page shows current count, size and rate limits. Check that you have permission to share each font.",
  guideSharing: "Share your finished work",
  guideSharingBody:
    "Choose Share subtitles in the subtitle library. Upload a ZIP or 7z archive and provide the anime, group and language. Community submissions are published after review. Keep credits and confirm permission to share.",
  guideAccess: "Group access and permissions",
  guideAccessBody:
    "For font maintenance, request group access and keep the application receipt. Once approved, claim your credential and enter the font workspace.",
  guideAccessScope:
    "Group credentials allow browsing, downloading and uploading fonts. Deletion, indexing and credential review are admin-only. Workshop credentials are managed separately from AniBT sign-in.",
  guideAccessSecret:
    "Credentials are stored in the current browser. Keep them out of links, screenshots and public comments. Back up the receipt secret separately: the server cannot recover it.",
  guideFaq: "Common questions",
  faqMissing: "What should I do about missing fonts?",
  faqMissingAnswer:
    "Copy the reported font name and check its family and weight. If you have a font you may share, contribute it and retry. You can also post the font name and error in Discussions.",
  faqSubset: "Does subsetting change the subtitles?",
  faqSubsetAnswer:
    "Subsetting keeps only the glyphs used to reduce embedded font data. Aliases, removal of embedded fonts and SRT conversion also update font references or file structure. Keep the originals and check the result.",
  faqPlayer: "Why should I check playback?",
  faqPlayerAnswer:
    "Players differ in their support for embedded ASS fonts. Enable font extraction to download fonts separately for loading or muxing. Missing glyphs require a suitable font.",
  faqPrivacy: "Are processed subtitles shared automatically?",
  faqPrivacyAnswer:
    "No. Processing and community submission are separate actions. Only archives submitted to the library and approved by a moderator are published.",
  guideOpen: "Open source and community",
  guideOpenBody:
    "The workshop uses the FontInAss engine under AGPL-3.0. The source project name, CLI commands and API paths stay compatible; the service and its guides are part of AniBT.",
  cliIntro:
    "Connect AniBT Subtitle Workshop to your local workflow. The FontInAss client supports batch processing, recursive scanning and file output.",
  cliDownloadIntro:
    "Download the client for your platform. On Linux and macOS, make it executable. On Windows, run it from a terminal.",
  cliReleases: "All releases",
  cliInstall: "Install and connect",
  cliInstallHint:
    "Rename the download to fontinass (fontinass.exe on Windows) and place it on your PATH, or use its full path. Set the workshop address before your first run.",
  cliExamples: "Common commands",
  cliOptions: "Processing options",
  cliOptionsBody:
    "For multi-track muxing, use a different alias salt for each track to avoid font-name conflicts. Strict mode stops output when fonts are missing.",
  cliConfig: "Local configuration",
  cliSource: "Full CLI documentation",
  copy: "Copy command",
  notFound: "This page could not be found",
  notFoundDesc: "Check the address or continue from the workshop overview.",
} satisfies Record<keyof typeof zh, string>;
