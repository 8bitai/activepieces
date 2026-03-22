import { createAction, Property } from '@activepieces/pieces-framework';
import { predefinedMimeTypes } from '../common/mimeTypes';
import mime from 'mime-types';

export const checkFileType = createAction({
  name: 'checkFileType',
  displayName: 'Check file type',
  description: 'Check MIME type of a file and filter based on selected types',
  props: {
    file: Property.File({
      displayName: 'File to Check',
      required: true,
    }),
    mimeTypes: Property.StaticDropdown({
      displayName: 'Select MIME Types',
      required: true,
      options: {
        options: predefinedMimeTypes,
      }, 
      description: 'Choose one or more MIME types to check against the file.',
    }),
  },
  async run(context) {
    const file = context.propsValue.file;

    if (!file) {
      throw new Error(
        'No file was received. Ensure the previous step (e.g. Web Form) outputs a file and that you selected that file in "File to Check". If the file comes from a form, use the form’s file field (e.g. Web Form → pdfFile).'
      );
    }

    const selectedMimeTypes = context.propsValue.mimeTypes;

    // Determine the MIME type: use extension first, then filename (e.g. "doc.pdf"), then fallback
    const fileType =
      (file.extension && mime.lookup(file.extension)) ||
      (file.filename && mime.lookup(file.filename)) ||
      'application/octet-stream';

    // Check if the file's MIME type matches any of the selected MIME types.
    const isMatch = fileType && selectedMimeTypes.includes(fileType);

    return {
      mimeType: fileType || 'unknown',
      isMatch,
    };
  },
});
