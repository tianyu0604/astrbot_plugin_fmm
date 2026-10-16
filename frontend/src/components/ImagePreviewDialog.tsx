import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut, Download } from 'lucide-react';
import { useState } from 'react';
import * as VisuallyHidden from '@radix-ui/react-visually-hidden';

interface ImagePreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  images: string[];
  initialIndex?: number;
  title?: string;
}

export function ImagePreviewDialog({
  open,
  onOpenChange,
  images,
  initialIndex = 0,
  title,
}: ImagePreviewDialogProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(1);

  const handlePrevious = () => {
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : images.length - 1));
    setZoom(1);
  };

  const handleNext = () => {
    setCurrentIndex((prev) => (prev < images.length - 1 ? prev + 1 : 0));
    setZoom(1);
  };

  const handleZoomIn = () => {
    setZoom((prev) => Math.min(prev + 0.25, 3));
  };

  const handleZoomOut = () => {
    setZoom((prev) => Math.max(prev - 0.25, 0.5));
  };

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = images[currentIndex];
    link.download = `image-${currentIndex + 1}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleClose = () => {
    setZoom(1);
    setCurrentIndex(initialIndex);
    onOpenChange(false);
  };

  if (images.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-7xl w-full h-[90vh] p-0 gap-0">
        <VisuallyHidden.Root>
          <DialogTitle>{title || '图片预览'}</DialogTitle>
          <DialogDescription>
            查看和浏览图片，支持缩放和导航功能
          </DialogDescription>
        </VisuallyHidden.Root>
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-4">
            {title && <h3 className="font-medium">{title}</h3>}
            {images.length > 1 && (
              <span className="text-sm text-muted-foreground">
                {currentIndex + 1} / {images.length}
              </span>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleZoomOut}
              disabled={zoom <= 0.5}
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="text-sm text-muted-foreground w-12 text-center">
              {Math.round(zoom * 100)}%
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleZoomIn}
              disabled={zoom >= 3}
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={handleDownload}>
              <Download className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={handleClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Image Container */}
        <div className="flex-1 relative bg-black/5 overflow-auto flex items-center justify-center">
          <img
            src={images[currentIndex]}
            alt={`Preview ${currentIndex + 1}`}
            className="max-w-full max-h-full object-contain transition-transform duration-200"
            style={{ transform: `scale(${zoom})` }}
          />

          {/* Navigation Buttons */}
          {images.length > 1 && (
            <>
              <Button
                variant="secondary"
                size="icon"
                className="absolute left-4 top-1/2 -translate-y-1/2 h-12 w-12 rounded-full shadow-lg"
                onClick={handlePrevious}
              >
                <ChevronLeft className="h-6 w-6" />
              </Button>
              <Button
                variant="secondary"
                size="icon"
                className="absolute right-4 top-1/2 -translate-y-1/2 h-12 w-12 rounded-full shadow-lg"
                onClick={handleNext}
              >
                <ChevronRight className="h-6 w-6" />
              </Button>
            </>
          )}
        </div>

        {/* Thumbnails */}
        {images.length > 1 && (
          <div className="border-t p-4">
            <div className="flex gap-2 overflow-x-auto">
              {images.map((img, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    setCurrentIndex(idx);
                    setZoom(1);
                  }}
                  className={`flex-shrink-0 w-20 h-20 rounded overflow-hidden border-2 transition-all ${
                    idx === currentIndex
                      ? 'border-primary ring-2 ring-primary'
                      : 'border-transparent hover:border-primary/50'
                  }`}
                >
                  <img
                    src={img}
                    alt={`Thumbnail ${idx + 1}`}
                    className="w-full h-full object-cover"
                  />
                </button>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
