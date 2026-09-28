import axiosInstance from './axiosInstance';

const uploadApi = {
  /**
   * Upload a file to a specific folder
   * @param {'logos'|'favicons'|'blog'|'og-images'|'general'} folder
   * @param {File} file
   * @returns {Promise<{success: boolean, file: {url: string, filename: string}}>}
   */
  upload: async (folder, file) => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await axiosInstance.post(`/api/v1/admin/upload/${folder}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  /**
   * Delete an uploaded file
   * @param {'logos'|'favicons'|'blog'|'og-images'|'general'} folder
   * @param {string} filename
   */
  delete: async (folder, filename) => {
    const response = await axiosInstance.delete(`/api/v1/admin/upload/${folder}/${filename}`);
    return response.data;
  },
};

export default uploadApi;
