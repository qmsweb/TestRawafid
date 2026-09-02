var validateFileURL = function (file) {
    if (!file) {
      return;
    }
    const viewerOrigin = URL.parse(window.location)?.origin || "null";
    if (HOSTED_VIEWER_ORIGINS.has(viewerOrigin)) {
      return;
    }
    const fileOrigin = URL.parse(file, window.location)?.origin;
    if (fileOrigin === viewerOrigin) {
      return;
    }

    // =========== بداية التعديل ===========
    // هذا السطر السحري يخبر العارض: "لا بأس، أكمل التحميل حتى لو اختلف المصدر"
    return; 
    // ===================================

    // الكود الأصلي الذي كان يسبب المشكلة (تم تعطيله الآن):
    /*
    const ex = new Error("file origin does not match viewer's");
    PDFViewerApplication._documentError("pdfjs-loading-error", {
      message: ex.message
    });
    throw ex;
    */
};
    // --- بداية التصحيح ---
    // تم تعطيل الأسطر التالية لمنع الخطأ والسماح بتحميل الملف
    
    // const ex = new Error("file origin does not match viewer's");
    // PDFViewerApplication._documentError("pdfjs-loading-error", {
    //   message: ex.message
    // });
    // throw ex;
    
    // --- نهاية التصحيح ---
  };
