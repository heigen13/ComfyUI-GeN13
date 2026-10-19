# Load Image Orient (GeN13) — 簡易載入節點,走 Pillow 解碼的 Load Image 替代品
# 背景:ComfyUI 核心 Load Image 改為先用 PyAV/ffmpeg 解碼並依 frame.rotation 旋轉,
# 對 iOS 原生截圖 PNG(帶 eXIf)PyAV 在 Windows 上會解出錯誤的 rotation(實測 135),
# 導致圖被逆時針轉 90°。本節點只走 Pillow + exif_transpose,不經 PyAV。
# widget 結構與核心 LoadImage 完全相同(只有 image),避免前端還原工作流時位置錯置。
# 讀圖程式與 Load Image Private 共用(nodes/image_io.py)。
import folder_paths

from .image_io import list_input_images, load_image_file, file_signature


class LoadImageOrient:
    @classmethod
    def INPUT_TYPES(s):
        return {"required": {"image": (list_input_images(), {
            "image_upload": True,
            "tooltip": "圖片:input 資料夾內的檔案,可上傳或拖放加入。"})}}

    CATEGORY = "GeN13/image"
    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("IMAGE", "MASK")
    OUTPUT_TOOLTIPS = ("影像:多幀檔輸出為批次。", "遮罩:透明區域為 1,無透明通道時全 0。")
    FUNCTION = "load_image"
    DESCRIPTION = "簡易載入圖片:只走 Pillow,iOS 截圖不會被轉向;與核心 Load Image 同欄位。"

    def load_image(self, image):
        path = folder_paths.get_annotated_filepath(image)
        img, mask, _, _ = load_image_file(path)
        return (img, mask)

    @classmethod
    def IS_CHANGED(s, image):
        return file_signature(folder_paths.get_annotated_filepath(image))

    @classmethod
    def VALIDATE_INPUTS(s, image):
        if not folder_paths.exists_annotated_filepath(image):
            return "Invalid image file: {}".format(image)
        return True


NODE_CLASS_MAPPINGS = {"LoadImageOrient": LoadImageOrient}
NODE_DISPLAY_NAME_MAPPINGS = {"LoadImageOrient": "Load Image Orient (GeN13)"}
